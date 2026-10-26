import Foundation
import Testing
@testable import PadelScoring

// Pontos (spec de 26 out): jogos de 0-15-30-40 sem sets; a ronda conta jogos.

@Test func pointsRoundCountsGamesWith15_30_40() {
    let (s, _) = play(match(.points, total: 24), "uu t")
    #expect(s.display == ScoreDisplay(us: .value("30"), them: .value("15"), status: .gamesRound(us: 0, them: 0, total: 24)))
    let (g, ev) = games(match(.points, total: 24), "uuu")
    #expect(g.games == [3, 0] && g.points == [0, 0] && g.sets.isEmpty && g.phase == .points)
    #expect(ev[0].contains(.gameWon) && ev[0].contains(.switchSides))   // 1.º jogo: ímpar
}

@Test func pointsRoundUsesDeuceMode() {
    let (s, ev) = play(match(.points, .golden, total: 24), "uuuttt")
    #expect(s.display.status == .goldenPoint && ev.last!.contains(.decisivePoint))
    let (adv, _) = play(match(.points, .advantage, total: 24), "uuuttt u")
    #expect(adv.display.us == .advantage)
}

@Test func pointsRoundLastGame() {
    let (s, _) = games(match(.points, total: 24), String(repeating: "ut", count: 11) + "u")   // 12-11
    let (end, ev) = games(s, "t")                                                             // 12-12
    #expect(end.isOver && end.winner == nil && end.resultText == "12-12" && ev.last!.contains(.matchOver))
    let (win, _) = games(match(.points, total: 16), String(repeating: "u", count: 9) + String(repeating: "t", count: 7))
    #expect(win.isOver && win.winner == .us && win.resultText == "9-7")
}

@Test func pointsWithoutTotalNeverEnds() {
    let (s, _) = games(match(.points, total: nil), String(repeating: "u", count: 60) + String(repeating: "t", count: 50))
    #expect(!s.isOver && s.games == [60, 50])
}

@Test func pointsServerRotatesPerGame() {
    let (s, _) = games(match(.points, server: .us, total: 24), "u")
    #expect(s.server == .them)
}

@Test func stopPointsRoundCountsClosedGamesOnly() {
    let (s, _) = games(match(.points, total: 24), "uut")
    let stopped = Scoring.stop(play(s, "tt").0, at: t0)
    #expect(stopped.resultText == "2-1" && stopped.winner == .us)
}

@Test func pointsSetsLineShowsGames() {
    #expect(games(match(.points, total: 24), "uut").0.setsLine == "2-1")
}

@Test func legacyRallyPointsMatchIsArchivedOnLoad() throws {
    // JSON gravado pela Fase 1: Pontos a meio com 15-9 corridos, sem `pointsScoring`.
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
    try legacyPointsSessionJSON(points: [15, 9]).write(to: url)
    let session = SessionStore(fileURL: url).load()
    #expect(session.current == nil)
    #expect(session.history.first?.resultText == "15-9" && session.history.first?.endReason == .stopped)
}
