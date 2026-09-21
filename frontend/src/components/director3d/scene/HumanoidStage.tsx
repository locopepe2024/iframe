import { Canvas, type ThreeEvent, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Fragment, Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";

import { CHARACTER_A_ID, humanoidUrl, rigProfile } from "../data/humanoid";
import { validateRigAdmission } from "../pose/rig-admission";
import { type ActorPathVectorField, type CharacterAuthoringState, useWorkbenchStore } from "../state/workbench-store";
import type { ActorPathState, CameraCompositionState, CameraPathState, JointDefinition, PerspectiveScenePlateCalibrationState, SceneObjectAuthoringState, TransformMode, ViewMode } from "../types";
import { reconnectControls } from "./control-lifecycle";
import { aspectRatioValue, cameraForwardTarget, cameraProjection, cameraRuntimePosition, cameraTargetPosition, evaluateDirectorFrame, stateTargetPosition } from "../timeline/timeline-evaluation";

interface RigRuntime {
  bones: Map<string, THREE.Bone>;
  restQuaternions: Map<string, THREE.Quaternion>;
}

function CanvasClearAlpha({ transparent }: { transparent: boolean }) {
  const { gl } = useThree();
  useEffect(() => { gl.setClearAlpha(transparent ? 0 : 1); }, [gl, transparent]);
  return null;
}

function PathEventMarkers() {
  const events = useWorkbenchStore((state) => state.pathEvents);
  return <>{events.map((event) => <group key={event.pathEventId} position={event.spatialAnchorM}><mesh renderOrder={18}><sphereGeometry args={[0.08, 16, 12]}/><meshBasicMaterial color={event.previewMarker.color} depthTest={false}/></mesh><mesh position={[0, 0, -0.08]}><ringGeometry args={[0.1, 0.13, 24]}/><meshBasicMaterial color={event.previewMarker.color} transparent opacity={0.75} side={THREE.DoubleSide}/></mesh></group>)}</>;
}

function PathLine({ points, color, opacity = 1 }: { points: THREE.Vector3[]; color: string; opacity?: number }) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
    return new THREE.Line(geometry, material);
  }, [color, opacity, points]);
  useEffect(() => () => { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }, [line]);
  return <primitive object={line} renderOrder={16}/>;
}

function DraggablePathControl({ ownerType, path, point, field, color, selected }: { ownerType: "actor" | "camera"; path: ActorPathState | CameraPathState; point: ActorPathState["controlPoints"][number]; field: ActorPathVectorField; color: string; selected: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { camera } = useThree();
  const selectActorControlPoint = useWorkbenchStore((state) => state.selectActorPathControlPoint);
  const beginActorDrag = useWorkbenchStore((state) => state.beginActorPathControlDrag);
  const previewActorVector = useWorkbenchStore((state) => state.previewActorPathControlVector);
  const commitActorDrag = useWorkbenchStore((state) => state.commitActorPathControlDrag);
  const cancelActorDrag = useWorkbenchStore((state) => state.cancelActorPathControlDrag);
  const selectCameraControlPoint = useWorkbenchStore((state) => state.selectCameraPathControlPoint);
  const beginCameraDrag = useWorkbenchStore((state) => state.beginCameraPathControlDrag);
  const previewCameraVector = useWorkbenchStore((state) => state.previewCameraPathControlVector);
  const commitCameraDrag = useWorkbenchStore((state) => state.commitCameraPathControlDrag);
  const cancelCameraDrag = useWorkbenchStore((state) => state.cancelCameraPathControlDrag);
  const selectControlPoint = ownerType === "actor" ? selectActorControlPoint : selectCameraControlPoint;
  const beginDrag = ownerType === "actor" ? beginActorDrag : beginCameraDrag;
  const previewVector = ownerType === "actor" ? previewActorVector : previewCameraVector;
  const commitDrag = ownerType === "actor" ? commitActorDrag : commitCameraDrag;
  const cancelDrag = ownerType === "actor" ? cancelActorDrag : cancelCameraDrag;
  const drag = useRef<{ pointerId: number; plane: THREE.Plane; offsetWorld: THREE.Vector3 } | null>(null);
  useEffect(() => () => {
    if (drag.current) cancelDrag();
    drag.current = null;
  }, [cancelDrag]);
  const startDrag = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || !meshRef.current) return;
    event.stopPropagation();
    selectControlPoint(point.controlPointId, field);
    const worldPosition = meshRef.current.getWorldPosition(new THREE.Vector3());
    const planeNormal = camera.getWorldDirection(new THREE.Vector3()).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal, worldPosition);
    const intersection = event.ray.intersectPlane(plane, new THREE.Vector3());
    if (!intersection) return;
    beginDrag(path.pathId, point.controlPointId, field);
    const activeTarget = ownerType === "actor" ? useWorkbenchStore.getState().actorPathDragTarget : useWorkbenchStore.getState().cameraPathDragTarget;
    if (!activeTarget || activeTarget.pathId !== path.pathId || activeTarget.controlPointId !== point.controlPointId || activeTarget.field !== field) return;
    drag.current = { pointerId: event.pointerId, plane, offsetWorld: worldPosition.clone().sub(intersection) };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  };
  const moveDrag = (event: ThreeEvent<PointerEvent>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId || !meshRef.current?.parent) return;
    event.stopPropagation();
    const intersection = event.ray.intersectPlane(active.plane, new THREE.Vector3());
    if (!intersection) return;
    const localPosition = meshRef.current.parent.worldToLocal(intersection.add(active.offsetWorld));
    previewVector(path.pathId, point.controlPointId, field, [localPosition.x, localPosition.y, localPosition.z]);
  };
  const finishDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    drag.current = null;
    commitDrag();
  };
  const abortDrag = (event: ThreeEvent<PointerEvent>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    event.stopPropagation();
    drag.current = null;
    cancelDrag();
  };
  const isPoint = field === "positionM";
  return <mesh
    ref={meshRef}
    position={point[field]}
    renderOrder={isPoint ? 18 : 17}
    onPointerDown={startDrag}
    onPointerMove={moveDrag}
    onPointerUp={finishDrag}
    onPointerCancel={abortDrag}
  >
    <sphereGeometry args={[selected ? (isPoint ? 0.095 : 0.055) : (isPoint ? 0.065 : 0.035), 16, 12]}/>
    <meshBasicMaterial color={selected ? "#F8FAFC" : color} transparent={!isPoint} opacity={isPoint ? 1 : 0.7} depthTest={false}/>
  </mesh>;
}

function ActorPathPreview({ path, selected }: { path: ActorPathState; selected: boolean }) {
  const selectedControlPointId = useWorkbenchStore((state) => state.selectedActorPathControlPointId);
  const selectedVectorField = useWorkbenchStore((state) => state.selectedActorPathVectorField);
  const points = useMemo(() => [...path.controlPoints].sort((left, right) => left.order - right.order), [path.controlPoints]);
  const samples = useMemo(() => points.slice(0, -1).flatMap((point, index) => {
    const next = points[index + 1];
    const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(...point.positionM), new THREE.Vector3(...point.handleOutM), new THREE.Vector3(...next.handleInM), new THREE.Vector3(...next.positionM));
    const segment = curve.getPoints(24);
    return index === 0 ? segment : segment.slice(1);
  }), [points]);
  const color = path.targetId === CHARACTER_A_ID ? "#38BDF8" : "#F472B6";
  if (!path.visible || samples.length < 2) return null;
  return <group>
    <PathLine points={samples} color={color}/>
    {selected && points.map((point) => <group key={point.controlPointId}>
      <PathLine points={[new THREE.Vector3(...point.handleInM), new THREE.Vector3(...point.positionM), new THREE.Vector3(...point.handleOutM)]} color={color} opacity={0.45}/>
      <DraggablePathControl ownerType="actor" path={path} point={point} field="handleInM" color={color} selected={selectedControlPointId === point.controlPointId && selectedVectorField === "handleInM"}/>
      <DraggablePathControl ownerType="actor" path={path} point={point} field="handleOutM" color={color} selected={selectedControlPointId === point.controlPointId && selectedVectorField === "handleOutM"}/>
      <DraggablePathControl ownerType="actor" path={path} point={point} field="positionM" color={color} selected={selectedControlPointId === point.controlPointId && selectedVectorField === "positionM"}/>
    </group>)}
  </group>;
}

function ActorPaths() {
  const paths = useWorkbenchStore((state) => state.actorPaths);
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  return <>{Object.values(paths).map((path) => <ActorPathPreview key={path.pathId} path={path} selected={path.targetId === selectedCharacterId}/>)}</>;
}

function CameraPathPreview({ path, selected }: { path: CameraPathState; selected: boolean }) {
  const selectedControlPointId = useWorkbenchStore((state) => state.selectedCameraPathControlPointId);
  const selectedVectorField = useWorkbenchStore((state) => state.selectedCameraPathVectorField);
  const points = useMemo(() => [...path.controlPoints].sort((left, right) => left.order - right.order), [path.controlPoints]);
  const samples = useMemo(() => points.slice(0, -1).flatMap((point, index) => {
    const next = points[index + 1];
    const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(...point.positionM), new THREE.Vector3(...point.handleOutM), new THREE.Vector3(...next.handleInM), new THREE.Vector3(...next.positionM));
    const segment = curve.getPoints(24);
    return index === 0 ? segment : segment.slice(1);
  }), [points]);
  if (!path.visible || samples.length < 2) return null;
  return <group>
    <PathLine points={samples} color={selected ? "#FBBF24" : "#A16207"} opacity={selected ? 1 : 0.45}/>
    {selected && points.map((point) => <group key={point.controlPointId}>
      <PathLine points={[new THREE.Vector3(...point.handleInM), new THREE.Vector3(...point.positionM), new THREE.Vector3(...point.handleOutM)]} color="#FBBF24" opacity={0.45}/>
      <DraggablePathControl ownerType="camera" path={path} point={point} field="handleInM" color="#FBBF24" selected={selectedControlPointId === point.controlPointId && selectedVectorField === "handleInM"}/>
      <DraggablePathControl ownerType="camera" path={path} point={point} field="handleOutM" color="#FBBF24" selected={selectedControlPointId === point.controlPointId && selectedVectorField === "handleOutM"}/>
      <DraggablePathControl ownerType="camera" path={path} point={point} field="positionM" color="#FBBF24" selected={selectedControlPointId === point.controlPointId && selectedVectorField === "positionM"}/>
    </group>)}
  </group>;
}

function CameraPaths() {
  const paths = useWorkbenchStore((state) => state.cameraPaths);
  const selectedCameraId = useWorkbenchStore((state) => state.selectedCameraId);
  return <>{Object.values(paths).map((path) => <CameraPathPreview key={path.pathId} path={path} selected={path.targetId === selectedCameraId}/>)}</>;
}

function StageCameraFrustum({ composition, selected, lookAtM, followM }: { composition: CameraCompositionState; selected: boolean; lookAtM: [number, number, number] | null; followM: [number, number, number] | null }) {
  const selectCamera = useWorkbenchStore((state) => state.selectCamera);
  const runtimePosition = cameraRuntimePosition(composition, followM);
  const targetM = lookAtM ?? followM;
  const projection = cameraProjection(composition.fovDeg, composition.zoom, composition.aspectRatio);
  const runtime = useMemo(() => {
    const camera = new THREE.PerspectiveCamera(projection.verticalFovDeg, projection.aspect, 0.1, 4);
    const helper = new THREE.CameraHelper(camera);
    return { camera, helper };
  }, [composition.cameraId, projection.aspect, projection.verticalFovDeg]);
  useEffect(() => {
    runtime.camera.position.set(...runtimePosition);
    runtime.camera.rotation.set(...composition.transform.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]);
    runtime.camera.fov = projection.verticalFovDeg;
    runtime.camera.zoom = 1;
    runtime.camera.aspect = projection.aspect;
    if (targetM) runtime.camera.lookAt(...targetM);
    runtime.camera.updateProjectionMatrix();
    runtime.camera.updateMatrixWorld(true);
    runtime.helper.update();
  }, [composition.transform, projection, runtime, runtimePosition, targetM]);
  useEffect(() => () => {
    runtime.helper.geometry.dispose();
    (runtime.helper.material as THREE.Material).dispose();
  }, [runtime]);
  if (!composition.visible) return null;
  return <group>
    <primitive object={runtime.helper}/>
    <mesh position={runtimePosition} rotation={composition.transform.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]} onClick={(event) => { event.stopPropagation(); selectCamera(composition.cameraId, true); }} renderOrder={19}>
      <boxGeometry args={[0.18, 0.12, 0.12]}/><meshBasicMaterial color={selected ? "#F8FAFC" : "#FBBF24"} depthTest={false}/>
    </mesh>
  </group>;
}

function ViewCamera({ viewMode, calibration, composition, compositionTargetM, compositionPositionM }: { viewMode: ViewMode; calibration: PerspectiveScenePlateCalibrationState | null; composition: CameraCompositionState; compositionTargetM: [number, number, number]; compositionPositionM: [number, number, number] }) {
  const { camera, gl } = useThree();
  const transformDragging = useWorkbenchStore((state) => state.transformDragging);
  const setViewportNavigation = useWorkbenchStore((state) => state.setViewportNavigation);
  const applyingNavigation = useRef(false);
  const controls = useMemo(() => {
    const instance = new OrbitControls(camera, gl.domElement);
    instance.enableDamping = true;
    instance.dampingFactor = 0.08;
    instance.target.set(0, 0, 0.9);
    return instance;
  }, [camera, gl.domElement]);
  useEffect(() => reconnectControls(controls, gl.domElement), [controls, gl.domElement]);
  useEffect(() => {
    if (calibration) {
      applyingNavigation.current = true;
      camera.position.set(...calibration.camera.positionM);
      camera.up.set(...calibration.camera.worldUp);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = calibration.camera.verticalFovDeg;
        camera.setViewOffset(calibration.imageWidth, calibration.imageHeight, (0.5 - calibration.camera.principalPointNormalized[0]) * calibration.imageWidth, (0.5 - calibration.camera.principalPointNormalized[1]) * calibration.imageHeight, calibration.imageWidth, calibration.imageHeight);
      }
      camera.updateProjectionMatrix();
      controls.target.set(...calibration.camera.lookAtM);
      controls.update();
      applyingNavigation.current = false;
      return;
    }
    if (viewMode === "camera") {
      applyingNavigation.current = true;
      const projection = cameraProjection(composition.fovDeg, composition.zoom, composition.aspectRatio);
      if (camera instanceof THREE.PerspectiveCamera) { camera.clearViewOffset(); camera.fov = projection.verticalFovDeg; camera.aspect = projection.aspect; }
      camera.position.set(...compositionPositionM);
      camera.up.set(0, 0, 1);
      camera.zoom = 1;
      controls.target.set(...compositionTargetM);
      camera.updateProjectionMatrix(); controls.update(); applyingNavigation.current = false; return;
    }
    const navigation = useWorkbenchStore.getState().viewportNavigation[viewMode];
    applyingNavigation.current = true;
    if (camera instanceof THREE.PerspectiveCamera) camera.clearViewOffset();
    camera.position.set(...navigation.positionM);
    camera.up.set(...navigation.up);
    camera.zoom = navigation.zoom;
    camera.updateProjectionMatrix();
    controls.target.set(...navigation.targetM);
    controls.update();
    applyingNavigation.current = false;
  }, [calibration, camera, composition, compositionPositionM, compositionTargetM, controls, viewMode]);
  useEffect(() => {
    const onChange = () => {
      if (applyingNavigation.current) return;
      setViewportNavigation(viewMode, {
        positionM: [camera.position.x, camera.position.y, camera.position.z],
        targetM: [controls.target.x, controls.target.y, controls.target.z],
        up: [camera.up.x, camera.up.y, camera.up.z],
        zoom: camera.zoom,
      });
    };
    controls.addEventListener("change", onChange);
    return () => controls.removeEventListener("change", onChange);
  }, [camera, controls, setViewportNavigation, viewMode]);
  useEffect(() => { controls.enabled = !transformDragging && !calibration && viewMode !== "camera"; }, [calibration, controls, transformDragging, viewMode]);
  useFrame(() => controls.update());
  return null;
}

function JointHandle({ joint, bone, selected, geometry }: { joint: JointDefinition; bone: THREE.Bone; selected: boolean; geometry: THREE.SphereGeometry }) {
  const ref = useRef<THREE.Mesh>(null);
  const selectJoint = useWorkbenchStore((state) => state.selectJoint);
  useFrame(() => { if (ref.current) bone.getWorldPosition(ref.current.position); });
  const onSelect = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    selectJoint(joint.joint_id);
  };
  return (
    <mesh ref={ref} geometry={geometry} onClick={onSelect} onPointerDown={(event) => event.stopPropagation()} renderOrder={20}>
      <meshBasicMaterial color={selected ? "#f9a8d4" : "#60a5fa"} depthTest={false} transparent opacity={selected ? 1 : 0.78} />
    </mesh>
  );
}

function HumanoidModel({
  character,
  selected,
  register,
}: {
  character: CharacterAuthoringState;
  selected: boolean;
  register: (characterId: string, group: THREE.Group | null) => void;
}) {
  const gltf = useLoader(GLTFLoader, humanoidUrl);
  const model = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const groupRef = useRef<THREE.Group>(null);
  const selectedJointId = useWorkbenchStore((state) => state.selectedJointId);
  const showJointHandles = useWorkbenchStore((state) => state.showJointHandles);
  const selectCharacter = useWorkbenchStore((state) => state.selectCharacter);
  const setRigAdmissionIssues = useWorkbenchStore((state) => state.setRigAdmissionIssues);
  const handleGeometry = useMemo(() => new THREE.SphereGeometry(0.018, 12, 8), []);
  const runtime = useMemo<RigRuntime>(() => {
    const bones = new Map<string, THREE.Bone>();
    const restQuaternions = new Map<string, THREE.Quaternion>();
    model.traverse((object) => {
      if (object instanceof THREE.Bone) {
        bones.set(object.name, object);
        restQuaternions.set(object.name, object.quaternion.clone());
      }
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.frustumCulled = false;
      }
    });
    return { bones, restQuaternions };
  }, [model]);

  useEffect(() => {
    register(character.characterId, groupRef.current);
    return () => register(character.characterId, null);
  }, [character.characterId, register]);
  useEffect(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(...character.transform.position);
    groupRef.current.rotation.set(...character.transform.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]);
    groupRef.current.scale.set(...character.transform.scale);
  }, [character.transform]);
  useEffect(() => {
    setRigAdmissionIssues(validateRigAdmission(rigProfile, new Set(runtime.bones.keys())));
  }, [runtime, setRigAdmissionIssues]);
  useEffect(() => {
    for (const joint of rigProfile.joints) {
      const bone = runtime.bones.get(joint.joint_id);
      const rest = runtime.restQuaternions.get(joint.joint_id);
      if (!bone || !rest) continue;
      const rotation = character.jointRotations[joint.joint_id] ?? { x: 0, y: 0, z: 0 };
      const delta = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(rotation.x),
        THREE.MathUtils.degToRad(rotation.y),
        THREE.MathUtils.degToRad(rotation.z),
        "XYZ",
      ));
      bone.quaternion.copy(rest).multiply(delta);
    }
  }, [character.jointRotations, runtime]);
  useEffect(() => () => handleGeometry.dispose(), [handleGeometry]);

  return (
    <Fragment>
      <group
        ref={groupRef}
        onClick={(event) => {
          event.stopPropagation();
          selectCharacter(character.characterId, event.nativeEvent.metaKey || event.nativeEvent.ctrlKey);
        }}
      >
        <group position={character.poseRootOffsetM} rotation={[Math.PI / 2, 0, 0]}>
          <primitive object={model} />
        </group>
      </group>
      {selected && !character.locked && showJointHandles && rigProfile.joints.filter((joint) => joint.control_class === "product_joint").map((joint) => {
        const bone = runtime.bones.get(joint.joint_id);
        return bone ? <JointHandle key={joint.joint_id} joint={joint} bone={bone} selected={joint.joint_id === selectedJointId} geometry={handleGeometry} /> : null;
      })}
    </Fragment>
  );
}

function TransformGizmo({ target, characterId, mode }: { target: THREE.Group | null; characterId: string; mode: TransformMode }) {
  const { camera, gl } = useThree();
  const character = useWorkbenchStore((state) => state.characters[characterId]);
  const beginTransformDrag = useWorkbenchStore((state) => state.beginTransformDrag);
  const previewTransformVector = useWorkbenchStore((state) => state.previewTransformVector);
  const commitTransformDrag = useWorkbenchStore((state) => state.commitTransformDrag);
  const cancelTransformDrag = useWorkbenchStore((state) => state.cancelTransformDrag);
  const controls = useMemo(() => new TransformControls(camera, gl.domElement), [camera, gl.domElement]);
  useEffect(() => reconnectControls(controls, gl.domElement), [controls, gl.domElement]);
  useEffect(() => {
    controls.setMode(mode);
    controls.setSpace(mode === "translate" ? "world" : "local");
  }, [controls, mode]);
  useEffect(() => {
    if (target) controls.attach(target);
    return () => { controls.detach(); };
  }, [controls, target]);
  useEffect(() => {
    const onDragging = (event: { value?: boolean }) => {
      if (event.value) beginTransformDrag(characterId);
      else commitTransformDrag(characterId, mode);
    };
    const onObjectChange = () => {
      if (!target) return;
      if (mode === "translate") previewTransformVector(characterId, "position", [target.position.x, target.position.y, character.transform.groundSnap ? 0 : target.position.z]);
      if (mode === "rotate") previewTransformVector(characterId, "rotationDeg", [target.rotation.x, target.rotation.y, target.rotation.z].map(THREE.MathUtils.radToDeg) as [number, number, number]);
      if (mode === "scale") previewTransformVector(characterId, "scale", [target.scale.x, target.scale.y, target.scale.z]);
    };
    controls.addEventListener("dragging-changed", onDragging as never);
    controls.addEventListener("objectChange", onObjectChange);
    return () => {
      controls.removeEventListener("dragging-changed", onDragging as never);
      controls.removeEventListener("objectChange", onObjectChange);
      cancelTransformDrag();
    };
  }, [beginTransformDrag, cancelTransformDrag, character.transform.groundSnap, characterId, commitTransformDrag, controls, mode, previewTransformVector, target]);
  return <primitive object={controls.getHelper()} />;
}

function LoadingModel() {
  return <mesh position={[0, 0, 0.9]}><capsuleGeometry args={[0.25, 1.2, 8, 16]} /><meshStandardMaterial color="#334155" wireframe /></mesh>;
}

function PrimitiveGeometry({ sceneObject }: { sceneObject: SceneObjectAuthoringState }) {
  const [width, depth, height] = sceneObject.dimensionsM;
  if (sceneObject.primitiveKind === "sphere") return <sphereGeometry args={[0.5, 32, 20]} />;
  if (sceneObject.primitiveKind === "cylinder") return <cylinderGeometry args={[0.5, 0.5, 1, 32]} />;
  if (sceneObject.primitiveKind === "torus") return <torusGeometry args={[0.4, 0.1, 16, 48]} />;
  if (sceneObject.primitiveKind === "cone") return <coneGeometry args={[0.5, 1, 32]} />;
  if (sceneObject.primitiveKind === "pyramid") return <coneGeometry args={[0.5, 1, 4]} />;
  return <boxGeometry args={[width, depth, height]} />;
}

function StageSceneObject({ sceneObject }: { sceneObject: SceneObjectAuthoringState }) {
  const selectSceneObject = useWorkbenchStore((state) => state.selectSceneObject);
  const selected = useWorkbenchStore((state) => state.selectedSceneObjectId === sceneObject.sceneObjectId);
  const [width, depth, height] = sceneObject.dimensionsM;
  const isVerticalRadial = ["cylinder", "cone", "pyramid"].includes(sceneObject.primitiveKind ?? "");
  const geometryScale: [number, number, number] = sceneObject.primitiveKind === "cube"
    ? [1, 1, 1]
    : sceneObject.primitiveKind === "torus"
      ? [width, depth, height / 0.2]
      : isVerticalRadial
        ? [width, height, depth]
        : [width, depth, height];
  return (
    <group position={sceneObject.transform.position} rotation={sceneObject.transform.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]} scale={sceneObject.transform.scale}>
      {sceneObject.objectKind === "empty" ? <group onClick={(event) => { event.stopPropagation(); selectSceneObject(sceneObject.sceneObjectId); }}><axesHelper args={[0.35]}/><mesh><sphereGeometry args={[0.08, 12, 8]}/><meshBasicMaterial transparent opacity={0.08}/></mesh></group> : <mesh
        position={sceneObject.pivotM.map((value) => -value) as [number, number, number]}
        rotation={isVerticalRadial ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
        scale={geometryScale}
        castShadow
        receiveShadow
        onClick={(event) => { event.stopPropagation(); selectSceneObject(sceneObject.sceneObjectId); }}
      >
        <PrimitiveGeometry sceneObject={sceneObject}/>
        <meshStandardMaterial color={sceneObject.materialHint?.color ?? "#94A3B8"} emissive={selected ? "#1D4ED8" : "#000000"} emissiveIntensity={selected ? 0.25 : 0} roughness={sceneObject.materialHint?.roughness ?? 0.8}/>
      </mesh>}
    </group>
  );
}

export function HumanoidStage() {
  const viewMode = useWorkbenchStore((state) => state.viewMode);
  const transformMode = useWorkbenchStore((state) => state.transformMode);
  const selectedCharacterId = useWorkbenchStore((state) => state.selectedCharacterId);
  const selectedCameraId = useWorkbenchStore((state) => state.selectedCameraId);
  const selectedActorPathControlPointId = useWorkbenchStore((state) => state.selectedActorPathControlPointId);
  const selectedCameraPathControlPointId = useWorkbenchStore((state) => state.selectedCameraPathControlPointId);
  const selectedSceneObjectId = useWorkbenchStore((state) => state.selectedSceneObjectId);
  const baseCharacters = useWorkbenchStore((state) => state.characters);
  const baseSceneObjects = useWorkbenchStore((state) => state.sceneObjects);
  const baseCameras = useWorkbenchStore((state) => state.cameras);
  const actorPaths = useWorkbenchStore((state) => state.actorPaths);
  const cameraPaths = useWorkbenchStore((state) => state.cameraPaths);
  const timeline = useWorkbenchStore((state) => state.dialogueTimeline);
  const playheadFrame = useWorkbenchStore((state) => state.playheadFrame);
  const evaluated = useMemo(() => evaluateDirectorFrame({ frame: playheadFrame, durationSeconds: timeline.durationSeconds, fps: timeline.fps, tracks: timeline.tracks, activeCameraTrackId: timeline.activeCameraTrackId, selectedCameraId, characters: baseCharacters, cameras: baseCameras, sceneObjects: baseSceneObjects, actorPaths, cameraPaths }), [actorPaths, baseCameras, baseCharacters, baseSceneObjects, cameraPaths, playheadFrame, selectedCameraId, timeline]);
  const charactersRecord = evaluated.characters;
  const characters = Object.values(charactersRecord);
  const sceneObjects = evaluated.sceneObjects;
  const cameras = evaluated.cameras;
  const sceneRootTransform = useWorkbenchStore((state) => state.renderScene.sceneRootTransform);
  const ground = useWorkbenchStore((state) => state.renderScene.ground);
  const skyColor = useWorkbenchStore((state) => state.renderScene.skyColor);
  const cameraComposition = cameras[evaluated.activeCameraId] ?? cameras[selectedCameraId] ?? Object.values(cameras)[0];
  const selectedCharacter = charactersRecord[selectedCharacterId];
  const lightDirection: [number, number, number] = [0.6, -0.8, 1];
  const [targets, setTargets] = useState<Record<string, THREE.Group | null>>({});
  const register = useMemo(() => (characterId: string, group: THREE.Group | null) => {
    setTargets((current) => current[characterId] === group ? current : { ...current, [characterId]: group });
  }, []);
  const lookAtTargetM = cameraTargetPosition(cameraComposition.lookAt, charactersRecord, sceneObjects);
  const followTargetM = cameraTargetPosition(cameraComposition.follow, charactersRecord, sceneObjects);
  const compositionPositionM = cameraRuntimePosition(cameraComposition, followTargetM);
  const compositionTargets = cameraComposition.subjectTargetIds.flatMap((targetId) => { const position = stateTargetPosition(targetId, charactersRecord, sceneObjects); return position ? [position] : []; });
  const compositionTargetM: [number, number, number] = lookAtTargetM ?? followTargetM ?? (compositionTargets.length ? compositionTargets.reduce((sum, value) => [sum[0] + value[0], sum[1] + value[1], sum[2] + value[2]] as [number, number, number], [0, 0, 0] as [number, number, number]).map((value) => value / compositionTargets.length) as [number, number, number] : cameraForwardTarget({ ...cameraComposition, transform: { ...cameraComposition.transform, position: compositionPositionM } }));
  const cameraAspectStyle = viewMode === "camera" ? { aspectRatio: String(aspectRatioValue(cameraComposition.aspectRatio)), minHeight: 0 } : undefined;
  return (
    <div id="director-viewport" className="viewport-shell" role="tabpanel" aria-labelledby={`view-tab-${viewMode}`} style={cameraAspectStyle}>
      <div className="scene-plate-three-layer">
      <Canvas
        shadows
        gl={{ alpha: true }}
        dpr={[1, 2]}
        camera={{ fov: 42, near: 0.01, far: 100, position: [3, -4.2, 2.2], up: [0, 0, 1] }}
        aria-label="双角色三维导演舞台。指针可直接操作；键盘用户可使用场景树、空间位置和关节数值控件完成同等编辑"
        aria-describedby="viewport-keyboard-help"
        role="img"
      >
        <CanvasClearAlpha transparent={false}/>
        <color attach="background" args={[skyColor]} />
        <hemisphereLight args={["#ffffff", "#263247", 2.2]} />
        <directionalLight position={lightDirection.map((value) => value * 5) as [number, number, number]} intensity={3.2} castShadow />
        <group position={sceneRootTransform.position} rotation={sceneRootTransform.rotationDeg.map(THREE.MathUtils.degToRad) as [number, number, number]} scale={sceneRootTransform.scale}>
          {ground.visible && <>
            <gridHelper args={[8, Math.max(1, Math.round(8 / ground.gridSpacingM)), "#52617a", "#263247"]} position={[0, 0, ground.heightM]} rotation={[Math.PI / 2, 0, 0]} />
            <mesh receiveShadow position={[0, 0, ground.heightM]}>
              <planeGeometry args={[10, 10]} />
              <meshStandardMaterial color="#111827" roughness={0.95} transparent opacity={ground.opacity} />
            </mesh>
          </>}
          <Suspense fallback={<LoadingModel />}>
            {characters.filter((character) => character.visible).map((character) => <HumanoidModel key={character.characterId} character={character} selected={!selectedSceneObjectId && character.characterId === selectedCharacterId} register={register} />)}
          </Suspense>
          <Suspense fallback={null}>{Object.values(sceneObjects).filter((sceneObject) => sceneObject.visible && sceneObject.browserCapabilityState === "available").map((sceneObject) => <StageSceneObject key={sceneObject.sceneObjectId} sceneObject={sceneObject}/>)}</Suspense>
          <ActorPaths />
          <CameraPaths />
          <PathEventMarkers />
          {Object.values(cameras).map((camera) => <StageCameraFrustum key={camera.cameraId} composition={camera} selected={camera.cameraId === selectedCameraId} lookAtM={cameraTargetPosition(camera.lookAt, charactersRecord, sceneObjects)} followM={cameraTargetPosition(camera.follow, charactersRecord, sceneObjects)}/>)}
        </group>
        {playheadFrame === 1 && !selectedSceneObjectId && !selectedActorPathControlPointId && !selectedCameraPathControlPointId && selectedCharacter?.visible && !selectedCharacter.locked && <TransformGizmo target={targets[selectedCharacterId] ?? null} characterId={selectedCharacterId} mode={transformMode} />}
        <ViewCamera viewMode={viewMode} calibration={null} composition={cameraComposition} compositionTargetM={compositionTargetM} compositionPositionM={compositionPositionM} />
      </Canvas>
      </div>
      {viewMode === "camera" && <div className="camera-framing-guides" aria-hidden="true">{cameraComposition.framingGuides.ruleOfThirds && <><span className="third vertical one"/><span className="third vertical two"/><span className="third horizontal one"/><span className="third horizontal two"/></>}{cameraComposition.framingGuides.centerCross && <><span className="center vertical"/><span className="center horizontal"/></>}{cameraComposition.framingGuides.safeArea && <span className="safe-area"/>}</div>}
      <p id="viewport-keyboard-help" className="sr-only">三维拖拽不是唯一操作方式。使用左侧场景对象选择人物，在右侧空间位置、关节调节和人物动作路径面板中输入精确数值。</p>
    </div>
  );
}

useLoader.preload(GLTFLoader, humanoidUrl);
