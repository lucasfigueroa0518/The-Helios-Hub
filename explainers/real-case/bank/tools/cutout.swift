// cutout.swift — lift the person out of a portrait (macOS Vision subject lifting) and write a
// transparent PNG cropped to them (planning/Real Case Reels/DECISIONS.md RC-34). Local, no network.
//
//   swift explainers/real-case/bank/tools/cutout.swift <in.jpg|png> <out.png>
//
// Prints one JSON line: {"ok":true,"width":…,"height":…,"instances":…} or {"ok":false,"error":"…"}.
import AppKit
import CoreImage
import Foundation
import Vision

func fail(_ message: String) -> Never {
  print("{\"ok\":false,\"error\":\"\(message.replacingOccurrences(of: "\"", with: "'"))\"}")
  exit(1)
}

let args = CommandLine.arguments
guard args.count == 3 else { fail("usage: cutout.swift <in> <out.png>") }
guard let image = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else { fail("cannot read \(args[1])") }

let handler = VNImageRequestHandler(ciImage: image, options: [:])
let request = VNGenerateForegroundInstanceMaskRequest()
do { try handler.perform([request]) } catch { fail("vision: \(error.localizedDescription)") }
guard let result = request.results?.first, !result.allInstances.isEmpty else { fail("no subject found") }

// Keep the largest subject only: a portrait's person, not a neighbour's arm or a second person.
let labels = result.instanceMask
CVPixelBufferLockBaseAddress(labels, .readOnly)
var counts: [Int: Int] = [:]
if let base = CVPixelBufferGetBaseAddress(labels) {
  let width = CVPixelBufferGetWidth(labels), height = CVPixelBufferGetHeight(labels)
  let stride = CVPixelBufferGetBytesPerRow(labels)
  for y in 0..<height {
    let row = base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self)
    for x in 0..<width where row[x] != 0 { counts[Int(row[x]), default: 0] += 1 }
  }
}
CVPixelBufferUnlockBaseAddress(labels, .readOnly)
let total = counts.values.reduce(0, +)
guard let largest = counts.max(by: { $0.value < $1.value }) else { fail("no subject pixels") }
let share = total > 0 ? Double(largest.value) / Double(total) : 1

let masked: CVPixelBuffer
do {
  masked = try result.generateMaskedImage(ofInstances: IndexSet(integer: largest.key), from: handler, croppedToInstancesExtent: true)
} catch { fail("mask: \(error.localizedDescription)") }

let out = CIImage(cvPixelBuffer: masked)
let context = CIContext()
guard let space = CGColorSpace(name: CGColorSpace.sRGB) else { fail("no sRGB") }
do {
  try context.writePNGRepresentation(of: out, to: URL(fileURLWithPath: args[2]), format: .RGBA8, colorSpace: space)
} catch { fail("write: \(error.localizedDescription)") }
print("{\"ok\":true,\"width\":\(Int(out.extent.width)),\"height\":\(Int(out.extent.height)),\"instances\":\(result.allInstances.count),\"share\":\(String(format: "%.2f", share))}")
