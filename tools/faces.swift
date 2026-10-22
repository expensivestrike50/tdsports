// Detect the largest face in each image with Apple's Vision framework.
// Usage: swift tools/faces.swift image1.jpg image2.jpg ...
// Prints one JSON line per image: {"file": ..., "face": [x, y, w, h]} with the box in
// 0-1 image coordinates measured from the TOP-left, or "face": null when none is found.
import Foundation
import Vision
import AppKit

for path in CommandLine.arguments.dropFirst() {
    var box: [Double]? = nil
    if let image = NSImage(contentsOfFile: path),
       let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) {
        let request = VNDetectFaceRectanglesRequest()
        try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
        if let face = (request.results ?? []).max(by: { $0.boundingBox.width < $1.boundingBox.width }) {
            let b = face.boundingBox  // Vision uses a bottom-left origin
            box = [b.origin.x, 1 - b.origin.y - b.height, b.width, b.height]
        }
    }
    let faceJSON = box.map { "[\($0.map { String(format: "%.4f", $0) }.joined(separator: ","))]" } ?? "null"
    let name = path.replacingOccurrences(of: "\"", with: "\\\"")
    print("{\"file\": \"\(name)\", \"face\": \(faceJSON)}")
}
