/** Stable destinations shared by panels, slot search and structured writes. */
export type CharacterDictionaryField = {
  id: string;
  label: string;
  domain: 'character.identity' | 'character.look' | 'character.performance';
  part: string;
  dimension: string;
  category: string;
  structured?: { section: 'identity' | 'look'; key: string };
};

const field = (
  id: string, label: string, domain: CharacterDictionaryField['domain'],
  part: string, dimension: string, category: string,
  structured?: CharacterDictionaryField['structured'],
): CharacterDictionaryField => ({ id, label, domain, part, dimension, category, structured });

export const CHARACTER_DICTIONARY_FIELDS: readonly CharacterDictionaryField[] = [
  field('identity.gender', '性别', 'character.identity', '人物', '性别', 'gender', { section: 'identity', key: 'gender' }),
  field('identity.age', '年龄阶段', 'character.identity', '人物', '年龄阶段', 'age-stage', { section: 'identity', key: 'age' }),
  field('identity.height', '身高', 'character.identity', '身体', '身高', 'height', { section: 'identity', key: 'height' }),
  field('identity.face.shape', '脸型', 'character.identity', '面部', '形状', 'face-shape', { section: 'identity', key: 'face_shape' }),
  field('identity.face.forehead', '额头', 'character.identity', '额头', '稳定形态', 'forehead', { section: 'identity', key: 'forehead' }),
  field('identity.face.cheekbones', '颧骨', 'character.identity', '颧骨', '稳定形态', 'cheekbones', { section: 'identity', key: 'cheekbones' }),
  field('identity.face.jaw', '下颌', 'character.identity', '下颌', '稳定形态', 'jaw', { section: 'identity', key: 'jaw' }),
  field('identity.face.chin', '下巴', 'character.identity', '下巴', '稳定形态', 'chin', { section: 'identity', key: 'chin' }),
  field('identity.face.eyes', '眼型', 'character.identity', '眼睛', '稳定形状', 'eyes', { section: 'identity', key: 'eyes' }),
  field('identity.face.brows', '眉形', 'character.identity', '眉毛', '稳定形状', 'brows', { section: 'identity', key: 'eyebrows' }),
  field('identity.face.eye_detail', '眼周纹理', 'character.identity', '眼周', '稳定纹理', 'eye-detail', { section: 'identity', key: 'eye_detail' }),
  field('identity.face.nose', '鼻型', 'character.identity', '鼻子', '稳定形状', 'nose', { section: 'identity', key: 'nose' }),
  field('identity.face.lips', '唇形', 'character.identity', '嘴唇', '稳定形状', 'lips', { section: 'identity', key: 'lips' }),
  field('identity.skin.tone', '肤色', 'character.identity', '皮肤', '基础颜色', 'skin-tone', { section: 'identity', key: 'skin_tone' }),
  field('identity.skin.texture', '肤质', 'character.identity', '皮肤', '稳定纹理', 'skin', { section: 'identity', key: 'skin_texture' }),
  field('identity.face.makeup', '妆容', 'character.identity', '面部', '妆容', 'makeup', { section: 'identity', key: 'makeup' }),
  field('identity.hair', '发型', 'character.identity', '头发', '稳定造型', 'hair', { section: 'identity', key: 'hair' }),
  field('identity.build', '体态', 'character.identity', '身体', '常态体态', 'posture', { section: 'identity', key: 'build' }),
  field('performance.expression', '表情', 'character.performance', '面部', '当前表情', 'expression'),
  field('performance.brow', '眉部表现', 'character.performance', '眉毛', '当前状态', 'expression-brow-state'),
  field('performance.eyelid', '眼睑表现', 'character.performance', '眼睑', '当前状态', 'expression-lid-state'),
  field('performance.gaze', '视线表现', 'character.performance', '视线', '当前方向与状态', 'expression-gaze-state'),
  field('performance.mouth', '嘴部表现', 'character.performance', '嘴部', '当前状态', 'expression-mouth-state'),
  field('performance.jaw', '下颌状态', 'character.performance', '下颌', '当前张力', 'expression-jaw-state'),
  field('performance.complexion', '面部气色', 'character.performance', '面部', '临时气色', 'expression-complexion-state'),
  field('look.condition.garment', '衣物状态', 'character.look', '服装', '新旧状态', 'garment-condition', { section: 'look', key: 'garment_condition' }),
  field('look.condition.jewelry', '首饰状态', 'character.look', '首饰', '新旧状态', 'jewelry-condition', { section: 'look', key: 'jewelry_condition' }),
  field('look.jewelry.hair', '头饰', 'character.look', '头部', '首饰', 'hair-jewelry'),
  field('look.jewelry.ear', '耳饰', 'character.look', '耳部', '首饰', 'ear-jewelry'),
  field('look.jewelry.neck', '颈饰', 'character.look', '颈部', '首饰', 'neck-jewelry'),
  field('look.jewelry.wrist', '腕饰', 'character.look', '腕部', '首饰', 'wrist-jewelry'),
  field('look.jewelry.waist', '腰间佩饰', 'character.look', '腰部', '首饰', 'waist-jewelry'),
  field('look.footwear.style', '古装鞋履', 'character.look', '鞋履', '整体款式', 'classical-shoes'),
  field('look.footwear.color', '鞋履颜色', 'character.look', '鞋履', '颜色', 'shoe-color'),
  field('look.footwear.material', '鞋履材质', 'character.look', '鞋履', '材质', 'shoe-material'),
  field('look.footwear.craft', '鞋履工艺', 'character.look', '鞋履', '工艺', 'shoe-craft'),
  field('look.footwear.pattern', '鞋履图案', 'character.look', '鞋履', '图案', 'shoe-pattern'),
  field('look.footwear.toe', '鞋头形状', 'character.look', '鞋履鞋头', '形状', 'shoe-toe'),
  field('look.footwear.sole', '鞋底结构', 'character.look', '鞋履鞋底', '结构', 'shoe-sole'),
  field('look.footwear.decoration', '鞋履装饰', 'character.look', '鞋履', '装饰', 'shoe-decoration'),
  field('look.footwear.lining', '鞋履内衬', 'character.look', '鞋履', '内衬', 'shoe-lining'),
  field('look.clothing.inner.color', '里衣颜色', 'character.look', '里衣', '颜色', 'palette'),
  field('look.clothing.inner.style', '古装里衣款式', 'character.look', '里衣', '款式', 'classical-inner'),
  field('look.clothing.outer.color', '外衣颜色', 'character.look', '外衣', '颜色', 'palette'),
  field('look.clothing.material', '面料', 'character.look', '服装', '材质', 'material'),
  field('look.clothing.outer.male', '男装外衣款式', 'character.look', '外衣', '男子古装款式', 'classical-male-outer'),
  field('look.clothing.outer.female', '女装上衣款式', 'character.look', '外衣', '女子古装款式', 'classical-female-upper'),
  field('look.clothing.bottom.color', '下装颜色', 'character.look', '下装', '颜色', 'palette'),
  field('look.clothing.bottom.trousers', '古装裤装款式', 'character.look', '下装', '古装裤款式', 'classical-trousers'),
  field('look.clothing.bottom.skirt.color', '裙装颜色', 'character.look', '裙装', '颜色', 'palette'),
  field('look.clothing.bottom.skirt.style', '古装裙装款式', 'character.look', '裙装', '古装款式', 'classical-skirt'),
  field('look.decoration.pattern', '花纹', 'character.look', '服装', '图案', 'pattern'),
  field('look.decoration.craft', '刺绣工艺', 'character.look', '服装', '刺绣工艺', 'craft'),
  field('look.decoration.scarf', '纱巾披帛', 'character.look', '肩臂', '披帛', 'scarf'),
  field('look.decoration.trim', '飘带', 'character.look', '服装', '装饰带', 'trim'),
  field('look.clothing.upper.color', '上衣颜色', 'character.look', '上衣', '颜色', 'palette'),
  field('look.clothing.upper.male', '男装上衣款式', 'character.look', '上衣', '现代男装款式', 'modern-male-upper'),
  field('look.clothing.coat.color', '外套颜色', 'character.look', '外套', '颜色', 'palette'),
  field('look.clothing.coat.male', '男装外套款式', 'character.look', '外套', '现代男装款式', 'modern-male-outer'),
  field('look.clothing.pants.color', '裤装颜色', 'character.look', '裤装', '颜色', 'palette'),
  field('look.clothing.pants.male', '男装裤装款式', 'character.look', '裤装', '现代男装款式', 'modern-male-bottoms'),
  field('look.clothing.upper.material', '上衣面料', 'character.look', '上衣', '材质', 'material'),
  field('look.clothing.pants.material', '裤装面料', 'character.look', '裤装', '材质', 'material'),
  field('look.clothing.fit', '版型', 'character.look', '服装', '版型', 'fit'),
  field('look.clothing.accessory', '搭配单品', 'character.look', '服装', '搭配', 'accessory'),
  field('look.footwear.modern_male', '男装鞋履', 'character.look', '鞋履', '现代男装款式', 'modern-male-shoes'),
  field('look.clothing.female.style', '女装款式', 'character.look', '服装', '现代女装款式', 'modern-female-garment'),
  field('look.clothing.color', '颜色', 'character.look', '服装', '颜色', 'palette'),
] as const;

const fieldsByLabel = new Map(CHARACTER_DICTIONARY_FIELDS.map(item => [item.label, item]));
export function characterDictionaryField(label: string): CharacterDictionaryField | undefined {
  return fieldsByLabel.get(label);
}
