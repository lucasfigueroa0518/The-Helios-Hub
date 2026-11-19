// The voice meter behind voice-screen.mjs (macOS only; built by tools/voice-screen.mjs).
// Apple's built-in SoundAnalysis classifier, offline. For each file: the highest confidence of any
// speech, singing, whispering or shouting label over 1 s windows (0.5 overlap).
//   voice-screen <file>...   prints: score<TAB>file   (ERR<TAB>file<TAB>reason on failure)
import Foundation
import SoundAnalysis
import AVFoundation

final class Obs: NSObject, SNResultsObserving {
  var maxSpeech = 0.0, speechWindows = 0, firstAt = -1.0, win = 0.0
  let labels = ["speech", "conversation", "narration_monologue", "male_speech_man_speaking", "female_speech_woman_speaking", "child_speech_kid_speaking", "whispering", "singing", "shout", "yell"]
  func request(_ r: SNRequest, didProduce result: SNResult) {
    guard let c = result as? SNClassificationResult else { return }
    var best = 0.0
    for l in labels { if let x = c.classification(forIdentifier: l) { best = max(best, x.confidence) } }
    maxSpeech = max(maxSpeech, best)
    if best >= 0.5 { speechWindows += 1; if firstAt < 0 { firstAt = c.timeRange.start.seconds } }
  }
}
for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path)
  do {
    let a = try SNAudioFileAnalyzer(url: url)
    let req = try SNClassifySoundRequest(classifierIdentifier: .version1)
    req.windowDuration = CMTime(seconds: 1.0, preferredTimescale: 48000)
    req.overlapFactor = 0.5
    let o = Obs()
    try a.add(req, withObserver: o)
    a.analyze()
    print(String(format: "%.3f\t%@", o.maxSpeech, path))
  } catch { print("ERR\t\(path)\t\(error)") }
}
