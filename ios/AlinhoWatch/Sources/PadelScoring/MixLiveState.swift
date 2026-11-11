import Foundation

/// O que o relógio manda ao `push_mix_live_score` a cada ponto: o placar como a
/// app o mostra, do lado do jogo do mix (dupla A / dupla B), não do relógio
/// («nós/eles»). Versão 1 da spec de 11 nov
/// (docs/superpowers/specs/2026-11-11-relogio-mix-pontos-ao-vivo-design.md).
/// Os pontos já vão em texto («15», «40», «AD»): a web não refaz as regras do 40-40.
public struct MixLiveState: Encodable, Equatable, Sendable {
    public let v: Int
    /// Sets fechados, `[A, B]`.
    public let sets: [[Int]]
    /// Jogos do set a decorrer, `[A, B]` (`[0, 0]` nos Pontos corridos).
    public let games: [Int]
    /// `0 15 30 40 AD` num jogo; o número num tie-break ou nos Pontos corridos.
    public let points: [String]
    /// `game | tie_break | super_tie_break | points`.
    public let phase: String
    /// `a | b`, ou `nil` se o relógio não souber quem serve.
    public let server: String?
    public let paused: Bool
    public let over: Bool

    public init(_ s: MatchState, side: MixSide) {
        // Os pares do relógio são [nós, eles]; do lado b trocam-se.
        func pair<T>(_ us: T, _ them: T) -> [T] { side == .a ? [us, them] : [them, us] }
        func mark(_ p: PointMark) -> String {
            switch p {
            case .value(let v): return v
            case .advantage: return "AD"
            }
        }
        let display = s.display
        v = 1
        sets = s.sets.map { pair($0.us, $0.them) }
        points = pair(mark(display.us), mark(display.them))
        switch s.phase {
        case .game: phase = "game"
        case .tieBreak: phase = "tie_break"
        case .superTieBreak: phase = "super_tie_break"
        case .points: phase = s.pointsScoring == .rally ? "points" : "game"
        }
        games = s.phase == .points && s.pointsScoring == .rally ? [0, 0] : pair(s.games[0], s.games[1])
        server = s.server.map { team in
            let ours = team == .us
            return (ours == (side == .a)) ? "a" : "b"
        }
        paused = s.pausedAt != nil
        over = s.isOver
    }
}
