import Foundation
import PadelScoring

/// Um jogo do mix a decorrer em que sou um dos quatro, como o RPC
/// `list_my_watch_mix_matches` o devolve (o JSON vem em snake_case).
public struct MixMatch: Decodable, Equatable, Identifiable, Sendable {
    public let matchID: UUID
    public let gameID: UUID
    /// O título do mix (`games.title`).
    public let gameName: String
    public let roundNumber: Int
    public let courtNumber: Int
    /// O lado da minha dupla.
    public let mySide: MixSide
    public let partnerName: String
    /// Os dois adversários.
    public let opponentNames: [String]
    /// `games.format`, `scoring_format`, `deuce_mode` e `tiebreak_8_8`, tal e qual:
    /// `MixRules.config` passa-os à configuração do relógio.
    public let format: String
    public let scoringFormat: String
    public let deuceMode: String
    public let tiebreak88: String?
    /// Quem está a contar este jogo, se alguém já carregou em «Começar».
    public let scorerID: UUID?
    public let scorerName: String?
    /// O jogo já tem resultado: ninguém volta a «Começar» (nem quem o gravou).
    /// Uma resposta sem o campo (migração antiga) conta como sem resultado.
    public let hasResult: Bool

    public var id: UUID { matchID }

    enum CodingKeys: String, CodingKey {
        case matchID = "match_id"
        case gameID = "game_id"
        case gameName = "game_name"
        case roundNumber = "round_number"
        case courtNumber = "court_number"
        case mySide = "my_side"
        case partnerName = "partner_name"
        case opponentNames = "opponent_names"
        case format
        case scoringFormat = "scoring_format"
        case deuceMode = "deuce_mode"
        case tiebreak88 = "tiebreak_8_8"
        case scorerID = "scorer_id"
        case scorerName = "scorer_name"
        case hasResult = "has_result"
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        matchID = try c.decode(UUID.self, forKey: .matchID)
        gameID = try c.decode(UUID.self, forKey: .gameID)
        gameName = try c.decode(String.self, forKey: .gameName)
        roundNumber = try c.decode(Int.self, forKey: .roundNumber)
        courtNumber = try c.decode(Int.self, forKey: .courtNumber)
        mySide = try c.decode(MixSide.self, forKey: .mySide)
        partnerName = try c.decode(String.self, forKey: .partnerName)
        opponentNames = try c.decode([String].self, forKey: .opponentNames)
        format = try c.decode(String.self, forKey: .format)
        scoringFormat = try c.decode(String.self, forKey: .scoringFormat)
        deuceMode = try c.decode(String.self, forKey: .deuceMode)
        tiebreak88 = try c.decodeIfPresent(String.self, forKey: .tiebreak88)
        scorerID = try c.decodeIfPresent(UUID.self, forKey: .scorerID)
        scorerName = try c.decodeIfPresent(String.self, forKey: .scorerName)
        hasResult = try c.decodeIfPresent(Bool.self, forKey: .hasResult) ?? false
    }
}

/// A resposta do RPC `claim_mix_match`: o jogo passou a ser meu, deste lado.
public struct ClaimResult: Decodable, Sendable {
    public let matchID: UUID
    public let mySide: MixSide

    enum CodingKeys: String, CodingKey {
        case matchID = "match_id"
        case mySide = "my_side"
    }
}
