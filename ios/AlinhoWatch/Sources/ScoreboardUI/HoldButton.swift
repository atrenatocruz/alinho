#if os(watchOS)
import SwiftUI

enum HoldDuration {
    /// Toque comprido para dar um ponto, desfazer e terminar. Afina-se no jogo de teste.
    static let seconds = 0.7
}

/// Dedo pousado: o véu enche durante `HoldDuration.seconds`; se o dedo sair antes
/// (ou escorregar), esvazia e não conta. Só um alvo de cada vez (`AppModel.activeHold`).
/// Usa um `DragGesture` simultâneo para não roubar o deslizar entre páginas.
struct HoldButton<Label: View>: View {
    let target: HoldTarget
    var fillFromBottom = true
    var fillColor: Color = Theme.ink.opacity(0.24)
    var cornerRadius: CGFloat = 16
    var disabled = false
    let onComplete: () -> Void
    @ViewBuilder let label: () -> Label

    @EnvironmentObject private var model: AppModel
    @Environment(\.isLuminanceReduced) private var dim
    @State private var progress: CGFloat = 0
    @State private var holdTask: Task<Void, Never>?
    /// O dedo está pousado e ainda não escorregou. É `@GestureState` porque volta
    /// sozinho a `false` quando o sistema cancela o gesto (o deslizar entre páginas,
    /// o pulso a baixar, uma notificação), coisa que o `onEnded` não apanha.
    @GestureState private var touch = Touch()

    private struct Touch: Equatable {
        var down = false
        var slipped = false
        var holding: Bool { down && !slipped }
    }

    var body: some View {
        label()
            .overlay {
                GeometryReader { geo in
                    fillColor
                        .frame(
                            width: fillFromBottom ? geo.size.width : geo.size.width * progress,
                            height: fillFromBottom ? geo.size.height * progress : geo.size.height
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: fillFromBottom ? .bottom : .leading)
                }
                .allowsHitTesting(false)
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius))
            .simultaneousGesture(
                DragGesture(minimumDistance: 0)
                    .updating($touch) { value, state, _ in
                        state.down = true
                        // Depois de escorregar já não volta a contar, mesmo que o dedo regresse.
                        if hypot(value.translation.width, value.translation.height) > 24 { state.slipped = true }
                    }
            )
            .onChange(of: touch.holding) { _, holding in
                if holding { begin() } else { cancel() }
            }
            .onDisappear { cancel() }
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { if !disabled { onComplete() } }
    }

    private func begin() {
        guard !disabled, model.activeHold == nil,
              WakeGuard.allowsHold(dimmedAtStart: dim, startedAt: Date(), wokeAt: model.wokeAt)
        else { return }
        model.activeHold = target
        Haptic.play(.touch)
        withAnimation(.linear(duration: HoldDuration.seconds)) { progress = 1 }
        holdTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(HoldDuration.seconds))
            guard !Task.isCancelled, model.activeHold == target else { return }
            model.activeHold = nil
            progress = 0
            onComplete()
        }
    }

    private func cancel() {
        holdTask?.cancel()
        holdTask = nil
        if model.activeHold == target { model.activeHold = nil }
        withAnimation(.easeOut(duration: 0.15)) { progress = 0 }
    }
}
#endif
