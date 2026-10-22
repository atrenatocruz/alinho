#if os(watchOS)
import CoreText
import SwiftUI

/// Cores e letras do relógio (spec, «Ecrãs»). Fundo sempre preto.
public enum Theme {
    static let lime = Color(hex: 0xC5DD01)
    static let themGrey = Color(hex: 0xD9DCE0)
    static let ink = Color(hex: 0x040404)
    static let red = Color(hex: 0xFF6B5E)
    static let listBg = Color(hex: 0x1D1E21)
    static let muted = Color(hex: 0x9EA3AA)
    static let topLine = Color(hex: 0xC9CCD1)
    // Pulso em baixo.
    static let dimLime = Color(hex: 0x3E4500)
    static let dimGrey = Color(hex: 0x2A2B2D)
    static let dimText = Color(hex: 0xC9CCD1)

    /// Números em Outfit 900 (`Outfit-Black.ttf`, nos recursos do pacote).
    static func number(_ size: CGFloat) -> Font {
        .custom("Outfit-Black", fixedSize: size)
    }

    /// Chamar uma vez no arranque da app.
    public static func registerFonts() {
        guard let url = Bundle.module.url(forResource: "Outfit-Black", withExtension: "ttf") else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
}

extension View {
    /// Cartão cinzento-escuro das listas (Últimos jogos, menu do jogo).
    func listCard() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(RoundedRectangle(cornerRadius: 14).fill(Theme.listBg))
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }
}
#endif
