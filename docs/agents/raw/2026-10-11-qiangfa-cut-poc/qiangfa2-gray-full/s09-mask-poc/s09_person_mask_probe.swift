import AppKit
import CoreImage
import Vision

guard CommandLine.arguments.count == 3 else {
    fputs("usage: swift s09_person_mask_probe.swift input.png output-prefix\n", stderr)
    exit(2)
}

let input = URL(fileURLWithPath: CommandLine.arguments[1])
let prefix = CommandLine.arguments[2]
let source = CIImage(contentsOf: input)!
let context = CIContext()
let handler = VNImageRequestHandler(url: input, options: [:])
let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = .accurate
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
try handler.perform([request])
guard let observation = request.results?.first else {
    fputs("person segmentation returned no observation\n", stderr)
    exit(1)
}

let rawMask = CIImage(cvPixelBuffer: observation.pixelBuffer)
let mask = rawMask.transformed(by: CGAffineTransform(
    scaleX: source.extent.width / rawMask.extent.width,
    y: source.extent.height / rawMask.extent.height
)).cropped(to: source.extent)
let green = CIImage(color: CIColor(red: 0, green: 1, blue: 0)).cropped(to: source.extent)
let preview = source.applyingFilter("CIBlendWithMask", parameters: [
    kCIInputBackgroundImageKey: green,
    kCIInputMaskImageKey: mask,
]).cropped(to: source.extent)

try context.writePNGRepresentation(of: mask, to: URL(fileURLWithPath: prefix + "-person-mask.png"),
                                   format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
try context.writePNGRepresentation(of: preview, to: URL(fileURLWithPath: prefix + "-green-preview.png"),
                                   format: .RGBA8, colorSpace: CGColorSpaceCreateDeviceRGB())
