import Foundation
import Testing
@testable import PadelScoring

private func rep(_ c: Character, _ n: Int) -> String { String(repeating: c, count: n) }

@Test func pointsEndsAtTotal() {
    let (s, ev) = play(match(.points, total: 24), rep("u", 15) + rep("t", 9))
    #expect(s.isOver && s.winner == .us && s.resultText == "15-9")
    #expect(ev.last!.contains(.matchOver))
    #expect(s.display == ScoreDisplay(us: .value("15"), them: .value("9"), status: .points(total: 24)))
    let (tie, _) = play(match(.points, total: 24), rep("u", 12) + rep("t", 12))
    #expect(tie.isOver && tie.winner == nil)
}

@Test func pointsWithoutTotalNeverEnds() {
    let (s, _) = play(match(.points, total: nil), rep("u", 120) + rep("t", 80))
    #expect(!s.isOver && s.points == [120, 80])
}

@Test func stopAtStartIsDraw() {
    let s = Scoring.stop(match(), at: t0)
    #expect(s.isOver && s.endReason == .stopped && s.winner == nil && s.resultText == "0-0")
}

@Test func stopCountsClosedGamesOnly() {
    let (s, _) = games(match(), "uuuutttt uu ttttuuuu tt uuuttt")
    let stopped = Scoring.stop(play(s, "uu").0, at: t0)
    #expect(stopped.resultText == "6-4 4-6 3-3" && stopped.winner == nil)
}

@Test func stopWithMoreGamesWins() {
    let (s, _) = games(match(), "uuuutttt uu ttttuuuu tt uuuttt u")
    #expect(Scoring.stop(s, at: t0).winner == .us)
}

@Test func stopDuringTieBreakIgnoresTieBreakPoints() {
    let (s, _) = games(match(), "uuuutttt uu uuuuu ttttt u t")
    #expect(s.phase == .tieBreak)
    let stopped = Scoring.stop(play(s, "uuuuu tttt").0, at: t0)
    #expect(stopped.resultText == "6-4 6-6" && stopped.winner == .us)
}

@Test func stopPointsByPoints() {
    let stopped = Scoring.stop(play(match(.points, total: nil), "ttu").0, at: t0)
    #expect(stopped.winner == .them && stopped.resultText == "1-2")
}

@Test func setsLineDuringMatch() {
    #expect(match().setsLine == "0-0")
    #expect(games(match(), "uuuutttt uu uuu tt").0.setsLine == "6-4 · 3-2")
}

@Test func resultTextByRules() {
    let (s, _) = games(match(.twoSetsSuperTieBreak), "uuuutttt uu ttttuuuu tt")
    let done = play(s, rep("u", 10) + "").0
    #expect(done.isOver && done.resultText == "6-4 4-6 10-0")
}

@Test func durationFormats() {
    #expect(durationText(from: t0, to: t0.addingTimeInterval(30)) == "1 min")
    #expect(durationText(from: t0, to: t0.addingTimeInterval(45 * 60)) == "45 min")
    #expect(durationText(from: t0, to: t0.addingTimeInterval(82 * 60)) == "1 h 22 min")
}
