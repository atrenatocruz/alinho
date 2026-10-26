import Foundation
import Testing
@testable import PadelScoring

// Segundo ecrã: pausa, acertar, mudar quem serve e o 40-40 a meio; tudo com desfazer.

@Test func deuceModeChangeWaitsForNextGame() {
    var ses = session(started: match(.bestOf3, .golden))
    ses.point(.us, at: t0); ses.setNextDeuceMode(.advantage)
    #expect(ses.current!.deuceMode == .golden && ses.current!.nextDeuceMode == .advantage)
    for _ in 0..<3 { ses.point(.us, at: t0) }
    #expect(ses.current!.deuceMode == .advantage && ses.current!.nextDeuceMode == nil)
}

@Test func choosingCurrentDeuceModeClearsPending() {
    var ses = session(started: match(.bestOf3, .golden))
    ses.setNextDeuceMode(.starPoint); ses.setNextDeuceMode(.golden)
    #expect(ses.current!.nextDeuceMode == nil)
}

@Test func correctRecomputesServerAndStarCount() {
    var ses = session(started: match(.bestOf3, .starPoint, server: .us))
    ses.correct(games: [3, 2], points: [3, 3])
    #expect(ses.current!.server == .them && ses.current!.deuceCount == 1)   // 5 jogos jogados: ímpar
    #expect(ses.current!.display.status == .deuce(1))
}

@Test func correctPicksOurPlayerByServiceGames() {
    // 4 jogos jogados, nós a abrir: servimos o 1.º (eu) e o 3.º (parceiro); o 5.º sou eu.
    var ses = session(started: match(.bestOf3, server: .us))
    ses.correct(games: [2, 2], points: [0, 0])
    #expect(ses.current!.server == .us && ses.current!.ourServer == .me)
}

@Test func correctClampsImpossibleScores() {
    var ses = session(started: match())
    ses.correct(games: [15, -1], points: [4, 1])
    #expect(ses.current!.games == [12, 0] && ses.current!.points == [3, 1])
    ses.correct(games: [0, 0], points: [4, 4])
    #expect(ses.current!.points == [3, 3])
}

@Test func gameWithoutPointsIsNotArchived() {
    var ses = session(started: match())
    ses.stop(at: t0)
    #expect(ses.history.isEmpty && ses.current!.isOver)
}

@Test func pointWhilePausedResumes() {
    var ses = session(started: match())
    ses.togglePause(at: t0.addingTimeInterval(60))
    ses.point(.us, at: t0.addingTimeInterval(160))
    #expect(ses.current!.pausedAt == nil && ses.current!.pausedSeconds == 100)
}

@Test func forgottenAfter20MinutesUnlessPaused() {
    var ses = session(started: match())
    ses.point(.us, at: t0)
    #expect(!ses.isForgotten(at: t0.addingTimeInterval(19 * 60)))
    #expect(ses.isForgotten(at: t0.addingTimeInterval(20 * 60)))
    ses.togglePause(at: t0.addingTimeInterval(60))
    #expect(!ses.isForgotten(at: t0.addingTimeInterval(40 * 60)))
}

@Test func undoWalksBackThroughMenuActions() {
    var ses = session(started: match(.bestOf3, .golden, server: .us))
    var snapshots = [ses.current!]
    ses.point(.us, at: t0);                         snapshots.append(ses.current!)
    ses.togglePause(at: t0);                        snapshots.append(ses.current!)
    ses.correct(games: [2, 1], points: [1, 0]);     snapshots.append(ses.current!)
    ses.setServer(.us, player: .partner);           snapshots.append(ses.current!)
    ses.point(.them, at: t0);                       snapshots.append(ses.current!)
    ses.setNextDeuceMode(.starPoint)
    while ses.undo() { #expect(ses.current == snapshots.popLast()) }
    #expect(snapshots.isEmpty)
}
