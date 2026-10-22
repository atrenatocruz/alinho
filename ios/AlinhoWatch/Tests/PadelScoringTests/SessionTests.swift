import Foundation
import Testing
@testable import PadelScoring

private func feed(_ s: inout MatchSession, _ seq: String) {
    for c in seq where c != " " { s.point(c == "u" ? .us : .them, at: t0) }
}

private func feedGames(_ s: inout MatchSession, _ seq: String) {
    for c in seq where c != " " { feed(&s, String(repeating: c, count: 4)) }
}

private func session(_ format: MatchFormat, _ mode: DeuceMode = .golden, server: Team? = nil, total: Int? = 24) -> MatchSession {
    var s = MatchSession()
    s.config = MatchConfig(format: format, deuceMode: mode, firstServer: server, pointsTotal: total)
    s.start(at: t0)
    return s
}

@Test func undoRestoresExactState() {
    var s = session(.bestOf3, .starPoint, server: .us)
    let initial = s.current
    feed(&s, "uuuttt utut")
    for _ in 0..<10 { #expect(s.undo()) }
    #expect(s.current == initial && !s.canUndo && !s.undo())
}

@Test func undoWalksBackAcrossTieBreakAndMatchEnd() {
    var s = session(.oneSet, server: .us)
    feedGames(&s, "utututututut")
    feed(&s, "uuuuuuu")
    #expect(s.current!.isOver && s.history.count == 1)
    #expect(s.undo())
    #expect(!s.current!.isOver && s.current!.phase == .tieBreak && s.history.isEmpty)
    for _ in 0..<6 { s.undo() }
    #expect(s.current!.phase == .tieBreak && s.current!.points == [0, 0] && s.current!.tieBreakFirstServer == .us)
    s.undo()
    #expect(s.current!.phase == .game && s.current!.games == [6, 5] && s.current!.points == [0, 3])
}

@Test func undoAfterStop() {
    var s = session(.bestOf3)
    feed(&s, "uu")
    s.stop(at: t0)
    #expect(s.current!.isOver && s.history.count == 1 && s.history[0].endReason == .stopped)
    #expect(s.undo())
    #expect(!s.current!.isOver && s.current!.points == [2, 0] && s.history.isEmpty)
}

@Test func historyNewestFirstMax20() {
    var s = MatchSession()
    s.config = MatchConfig(format: .points, deuceMode: .golden, firstServer: nil, pointsTotal: 16)
    var lastID: UUID?
    for i in 0..<21 {
        s.start(at: t0)
        lastID = s.current!.id
        feed(&s, String(repeating: i % 2 == 0 ? "u" : "t", count: 16))
        s.clearFinished()
    }
    #expect(s.history.count == MatchSession.historyLimit)
    #expect(s.history[0].id == lastID && s.history[0].winner == .us && s.history[0].resultText == "16-0")
    #expect(s.current == nil && !s.canUndo)
}

@Test func pointIgnoredWhenOver() {
    var s = session(.points, total: 16)
    feed(&s, String(repeating: "u", count: 16))
    let done = s
    let events = s.point(.them, at: t0)
    #expect(events.isEmpty && s == done)
}

@Test func recordKeepsWhatPhase2Needs() {
    var s = session(.twoSetsSuperTieBreak, .advantage)
    feedGames(&s, "uuuuuu")
    s.stop(at: t0.addingTimeInterval(3600))
    let r = s.history[0]
    #expect(r.format == .twoSetsSuperTieBreak && r.deuceMode == .advantage)
    #expect(r.sets == [SetScore(6, 0, .normal)] && r.winner == .us && r.startedAt == t0)
    #expect(r.endedAt == t0.addingTimeInterval(3600) && r.resultText == "6-0")
}

private func tempURL() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("alinho-\(UUID().uuidString).json")
}

@Test func storeRoundTripsMidMatch() throws {
    var s = session(.bestOf3, .starPoint, server: .them)
    feedGames(&s, "uut")
    feed(&s, "uuuttt u")
    let store = SessionStore(fileURL: tempURL())
    try store.save(s)
    #expect(store.load() == s)
}

@Test func storeIgnoresCorruptFile() throws {
    let url = tempURL()
    try Data("{nope".utf8).write(to: url)
    #expect(SessionStore(fileURL: url).load() == MatchSession())
    #expect(SessionStore(fileURL: tempURL()).load() == MatchSession())
}
