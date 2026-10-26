import Foundation

/// Qual dos dois lados do jogo do mix é a dupla de quem tem o relógio («Nós»).
public enum MixSide: String, Codable, Sendable { case a, b }

/// Um set no formato de `p_sets` do RPC `save_mix_match_result`. Os nomes em
/// snake_case são de propósito: este JSON vai tal e qual.
public struct MixSet: Codable, Equatable, Sendable {
    public let score_a: Int
    public let score_b: Int
    public let is_super_tiebreak: Bool

    public init(score_a: Int, score_b: Int, is_super_tiebreak: Bool) {
        self.score_a = score_a
        self.score_b = score_b
        self.is_super_tiebreak = is_super_tiebreak
    }
}

/// Do formato de um jogo do mix (`games.format`, `scoring_format`, `deuce_mode`,
/// `tiebreak_8_8`) para a configuração do relógio.
public enum MixRules {
    /// `nil` = o relógio não sabe contar este jogo (formato, modo do 40-40 ou
    /// tie-break desconhecidos, ou `tiebreak_8_8 == "super_tiebreak"` no Pro Set).
    public static func config(gameFormat: String, scoringFormat: String, deuceMode: String, tiebreak88: String?) -> MatchConfig? {
        guard let deuce = deuce(from: deuceMode) else { return nil }
        let format: MatchFormat
        switch scoringFormat {
        case "pontos_corridos": format = .points
        case "pontos_simples": format = gameFormat == "americano" ? .points : .endlessSet
        case "set_sem_fim": guard gameFormat == "americano" else { return nil }; format = .endlessSet
        case "pro_set_9":
            guard tiebreak88 == nil || tiebreak88 == "tiebreak" else { return nil }
            format = .proSet9
        case "melhor_2_sets": format = .twoSetsSuperTieBreak
        case "melhor_3_sets": format = .bestOf3
        default: return nil
        }
        return MatchConfig(format: format, deuceMode: deuce, firstServer: nil, pointsTotal: nil)
    }

    private static func deuce(from db: String) -> DeuceMode? {
        switch db {
        case "ponto_de_ouro": return .golden
        case "vantagens": return .advantage
        case "star_point": return .starPoint
        default: return nil
        }
    }
}

/// O resultado de um jogo acabado, como o RPC `save_mix_match_result` o quer:
/// `sets` só nos formatos por sets; nos outros, `scoreA`/`scoreB` são jogos ou pontos.
public struct MixResult: Codable, Equatable, Sendable {
    public let scoreA: Int
    public let scoreB: Int
    public let sets: [MixSet]?

    public init(record r: MatchRecord, side: MixSide) {
        // Os pares do relógio são [nós, eles]; do lado b trocam-se.
        func pair(_ us: Int, _ them: Int) -> (a: Int, b: Int) { side == .a ? (us, them) : (them, us) }
        switch r.format {
        case .points, .endlessSet:
            // Como o `WatchGamePayload`: jogos da ronda, ou pontos corridos.
            let p = r.games.isEmpty ? r.points : r.games
            let s = pair(p.first ?? 0, p.count > 1 ? p[1] : 0)
            scoreA = s.a; scoreB = s.b; sets = nil
        case .proSet9, .oneSet:
            // Um só set: o resultado são os jogos desse set.
            let s = pair(r.sets.first?.us ?? 0, r.sets.first?.them ?? 0)
            scoreA = s.a; scoreB = s.b; sets = nil
        case .bestOf3, .twoSetsSuperTieBreak:
            let list = r.sets.map { set -> MixSet in
                let s = pair(set.us, set.them)
                return MixSet(score_a: s.a, score_b: s.b, is_super_tiebreak: set.kind == .superTieBreak)
            }
            scoreA = list.filter { $0.score_a > $0.score_b }.count
            scoreB = list.filter { $0.score_b > $0.score_a }.count
            sets = list
        }
    }
}
