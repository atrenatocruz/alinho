#if os(watchOS)
import SwiftUI

public struct RootView: View {
    public init() {}

    public var body: some View {
        Text(L.t("Novo jogo"))
            .font(Theme.number(20))
            .foregroundStyle(Theme.lime)
    }
}
#endif
