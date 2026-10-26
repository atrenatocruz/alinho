#if os(watchOS)
import PadelScoring
import WatchKit

/// Vibrações: leve ao pousar o dedo; um toque quando o ponto é de Nós e dois quando
/// é de Eles (para se saber sem olhar); dupla para trocar de lado e no ponto
/// decisivo; longa no fim de um set e do jogo. Os tipos exatos afinam-se no pulso.
enum Haptic {
    case touch, double, long, undo

    static func play(_ h: Haptic) {
        let type: WKHapticType = switch h {
        case .touch: .click
        case .double: .notification
        case .long: .success
        case .undo: .directionDown
        }
        WKInterfaceDevice.current().play(type)
    }

    /// Ponto contado: um toque para Nós, dois para Eles.
    static func point(_ team: Team) {
        WKInterfaceDevice.current().play(.directionUp)
        guard team == .them else { return }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(160))
            WKInterfaceDevice.current().play(.directionUp)
        }
    }
}
#endif
