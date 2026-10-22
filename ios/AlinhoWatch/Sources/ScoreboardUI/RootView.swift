#if os(watchOS)
import SwiftUI

/// Sem jogo: «Novo jogo». Jogo a decorrer: marcador e menu do jogo. Jogo acabado:
/// o ecrã de fim.
public struct RootView: View {
    @StateObject private var model = AppModel()

    public init() {}

    public var body: some View {
        Group {
            if let match = model.current {
                Text(match.setsLine)
            } else {
                SetupView()
            }
        }
        .environmentObject(model)
    }
}
#endif
