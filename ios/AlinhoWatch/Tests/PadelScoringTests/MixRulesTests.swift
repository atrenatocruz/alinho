import Foundation
import Testing
@testable import PadelScoring

// Formato e resultado de um jogo do mix: da config do jogo (`games.format`,
// `scoring_format`, `deuce_mode`, `tiebreak_8_8`) para o `MatchConfig` do relógio,
// e do `MatchRecord` acabado para o que o RPC `save_mix_match_result` espera.

private func rep(_ c: Character, _ n: Int) -> String { String(repeating: c, count: n) }

private func record(_ s: MatchState) -> MatchRecord { MatchRecord(s) }

/// 6-4 3-6 6-2 do ponto de vista de «Nós».
private func bestOf3Record() -> MatchRecord {
    let (s, _) = games(match(.bestOf3), "uuuutttt uu" + "ttt uuu ttt" + "uu tt uuuu")
    #expect(s.isOver)
    return record(s)
}

// MARK: - Mapeamento

@Test func mixMappingTable() {
    func fmt(_ g: String, _ s: String, _ d: String = "ponto_de_ouro", _ tb: String? = nil) -> MatchFormat? {
        MixRules.config(gameFormat: g, scoringFormat: s, deuceMode: d, tiebreak88: tb)?.format
    }
    #expect(fmt("sobe_desce", "pontos_simples") == .endlessSet)
    #expect(fmt("sobe_desce", "pontos_corridos") == .points)
    #expect(fmt("americano", "pontos_corridos") == .points)
    #expect(fmt("americano", "pontos_simples") == .points)
    #expect(fmt("americano", "set_sem_fim") == .endlessSet)
    #expect(fmt("sobe_desce", "pro_set_9") == .proSet9)
    #expect(fmt("sobe_desce", "pro_set_9", "ponto_de_ouro", "tiebreak") == .proSet9)
    #expect(fmt("sobe_desce", "melhor_2_sets") == .twoSetsSuperTieBreak)
    #expect(fmt("sobe_desce", "melhor_3_sets") == .bestOf3)
    #expect(fmt("sobe_desce", "pro_set_9", "ponto_de_ouro", "super") == nil)
    #expect(fmt("sobe_desce", "pro_set_9", "ponto_de_ouro", "super_tiebreak") == nil)
    #expect(fmt("sobe_desce", "sets_livres") == nil)
}

@Test func mixMappingConfigDetails() {
    let c = MixRules.config(gameFormat: "sobe_desce", scoringFormat: "pontos_simples", deuceMode: "ponto_de_ouro", tiebreak88: nil)
    #expect(c?.format == .endlessSet && c?.deuceMode == .golden)
    #expect(c?.firstServer == nil && c?.pointsTotal == nil)
    let p = MixRules.config(gameFormat: "americano", scoringFormat: "pontos_simples", deuceMode: "ponto_de_ouro", tiebreak88: nil)
    #expect(p?.format == .points && p?.pointsTotal == nil)
}

@Test func mixMappingDeuceModes() {
    func mode(_ d: String) -> DeuceMode? {
        MixRules.config(gameFormat: "sobe_desce", scoringFormat: "melhor_3_sets", deuceMode: d, tiebreak88: nil)?.deuceMode
    }
    #expect(mode("ponto_de_ouro") == .golden)
    #expect(mode("vantagens") == .advantage)
    #expect(mode("star_point") == .starPoint)
    #expect(mode("xyz") == nil)
    #expect(MixRules.config(gameFormat: "sobe_desce", scoringFormat: "melhor_3_sets", deuceMode: "xyz", tiebreak88: nil) == nil)
}

// MARK: - Resultado

@Test func mixBestOf3SideA() {
    let r = MixResult(record: bestOf3Record(), side: .a)
    #expect(r.scoreA == 2 && r.scoreB == 1)
    #expect(r.sets == [MixSet(score_a: 6, score_b: 4, is_super_tiebreak: false),
                       MixSet(score_a: 3, score_b: 6, is_super_tiebreak: false),
                       MixSet(score_a: 6, score_b: 2, is_super_tiebreak: false)])
}

@Test func mixBestOf3SideBSwaps() {
    let r = MixResult(record: bestOf3Record(), side: .b)
    #expect(r.scoreA == 1 && r.scoreB == 2)
    #expect(r.sets == [MixSet(score_a: 4, score_b: 6, is_super_tiebreak: false),
                       MixSet(score_a: 6, score_b: 3, is_super_tiebreak: false),
                       MixSet(score_a: 2, score_b: 6, is_super_tiebreak: false)])
}

@Test func mixSuperTieBreakFlag() {
    let (s, _) = games(match(.twoSetsSuperTieBreak), "uuuutttt uu" + "tttt uuuu tt")
    let (end, _) = play(s, rep("u", 8) + rep("t", 8) + "uu")
    #expect(end.isOver)
    let r = MixResult(record: record(end), side: .a)
    #expect(r.scoreA == 2 && r.scoreB == 1)
    #expect(r.sets?.map(\.is_super_tiebreak) == [false, false, true])
    #expect(r.sets?.last == MixSet(score_a: 10, score_b: 8, is_super_tiebreak: true))
}

@Test func mixProSetIsGamesNoSets() {
    let (s, _) = games(match(.proSet9), rep("u", 0) + "ututututututut" + "uu")
    #expect(s.isOver)
    let r = MixResult(record: record(s), side: .a)
    #expect(r.scoreA == 9 && r.scoreB == 7 && r.sets == nil)
    let b = MixResult(record: record(s), side: .b)
    #expect(b.scoreA == 7 && b.scoreB == 9 && b.sets == nil)
}

@Test func mixEndlessSetIsGames() {
    let (s, _) = games(match(.endlessSet), "uuuuu ttt")
    let r = MixResult(record: record(Scoring.stop(s, at: t0)), side: .a)
    #expect(r.scoreA == 5 && r.scoreB == 3 && r.sets == nil)
}

@Test func mixPointsIsPoints() {
    let (s, _) = play(match(.points, total: nil), rep("u", 21) + rep("t", 17))
    let r = MixResult(record: record(Scoring.stop(s, at: t0)), side: .a)
    #expect(r.scoreA == 21 && r.scoreB == 17 && r.sets == nil)
}
