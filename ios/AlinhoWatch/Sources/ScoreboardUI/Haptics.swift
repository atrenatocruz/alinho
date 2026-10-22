#if os(watchOS)
import WatchKit

/// Vibrações do PDF: leve ao pousar o dedo; forte quando o ponto conta; dupla
/// para trocar de lado e no ponto decisivo; longa no fim de um set e do jogo.
/// Os tipos exatos afinam-se no pulso.
enum Haptic {
    case touch, counted, double, long, undo

    static func play(_ h: Haptic) {
        let type: WKHapticType = switch h {
        case .touch: .click
        case .counted: .directionUp
        case .double: .notification
        case .long: .success
        case .undo: .directionDown
        }
        WKInterfaceDevice.current().play(type)
    }
}
#endif
