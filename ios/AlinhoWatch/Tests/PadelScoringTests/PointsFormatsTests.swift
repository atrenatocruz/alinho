import Foundation
import Testing
@testable import PadelScoring

// Decisão do Francisco (26 out): «Pontos corridos» (1, 2, 3… até ao total) e
// «Set sem fim» (15-30-40, o set nunca acaba, ganha quem tiver mais jogos).

private func rep(_ c: Character, _ n: Int) -> String { String(repeating: c, count: n) }

// MARK: - Pontos corridos

@Test func runningPointsEndAtTotal() {
    let (s, ev) = play(match(.points, total: 24), rep("u", 15) + rep("t", 9))
    #expect(s.isOver && s.winner == .us && s.resultText == "15-9")
    #expect(ev.last!.contains(.matchOver))
    #expect(s.display == ScoreDisplay(us: .value("15"), them: .value("9"), status: .points(total: 24)))
    let (tie, _) = play(match(.points, total: 24), rep("u", 12) + rep("t", 12))
    #expect(tie.isOver && tie.winner == nil)
}

@Test func runningPointsWithoutTotalNeverEnd() {
    let (s, _) = play(match(.points, total: nil), rep("u", 120) + rep("t", 80))
    #expect(!s.isOver && s.points == [120, 80])
}

@Test func runningPointsHaveNoServer() {
    #expect(match(.points, server: .us).server == nil)
}

@Test func runningPointsLastPointIsMatchPoint() {
    let (s, _) = play(match(.points, total: 24), rep("u", 12) + rep("t", 11))
    #expect(s.statusLine == .matchPoint)
}

@Test func phase1RunningPointsMatchKeepsGoingAfterUpdate() throws {
    // JSON gravado pela Fase 1: Pontos a meio com 15-9, sem os campos novos.
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
    try legacyPointsSessionJSON(points: [15, 9]).write(to: url)
    let session = SessionStore(fileURL: url).load()
    #expect(session.current?.points == [15, 9] && session.current?.isOver == false)
    #expect(session.current?.display.status == .points(total: 24))
}

// MARK: - Set sem fim

@Test func endlessSetCountsGamesWith15_30_40() {
    let (s, _) = play(match(.endlessSet), "uu t")
    #expect(s.display == ScoreDisplay(us: .value("30"), them: .value("15"), status: .gamesRound(us: 0, them: 0, total: nil)))
    let (g, ev) = games(match(.endlessSet), "uuu")
    #expect(g.games == [3, 0] && g.points == [0, 0] && g.sets.isEmpty && !g.isOver)
    #expect(ev[0].contains(.gameWon) && ev[0].contains(.switchSides))   // 1.º jogo: ímpar
}

@Test func endlessSetNeverEndsEvenWithATotalInTheConfig() {
    let (s, _) = games(match(.endlessSet, total: 24), rep("u", 30) + rep("t", 20))
    #expect(!s.isOver && s.games == [30, 20] && s.statusLine == .gamesRound(us: 30, them: 20, total: nil))
}

@Test func endlessSetUsesDeuceModeAndServer() {
    let (s, ev) = play(match(.endlessSet, .golden), "uuuttt")
    #expect(s.display.status == .goldenPoint && ev.last!.contains(.decisivePoint))
    #expect(games(match(.endlessSet, server: .us), "u").0.server == .them)
}

@Test func endlessSetEndsOnStopWithClosedGames() {
    let (s, _) = games(match(.endlessSet), "uuuuuuu")
    let stopped = Scoring.stop(play(s, "tt").0, at: t0)
    #expect(stopped.resultText == "7-0" && stopped.winner == .us && stopped.setsLine == "7-0")
    let draw = Scoring.stop(games(match(.endlessSet), "ut").0, at: t0)
    #expect(draw.winner == nil && draw.resultText == "1-1")
}
