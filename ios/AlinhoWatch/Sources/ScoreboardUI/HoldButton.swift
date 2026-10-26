#if os(watchOS)
import PadelScoring
import SwiftUI

enum HoldDuration {
    /// Toque comprido para dar um ponto, desfazer e terminar. Afina-se no jogo de teste.
    static let seconds = 0.7
}

/// Dedo pousado: o véu enche durante `HoldDuration.seconds`; se o dedo sair antes
/// (ou escorregar), esvazia e não conta. Só um alvo de cada vez (`AppModel.activeHold`).
/// O toque vem de um toque comprido que nunca chega ao fim (só `onPressingChanged`):
/// um `DragGesture`, mesmo simultâneo, roubava o deslizar entre páginas por cima dos blocos.
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
    /// O dedo está pousado e ainda não escorregou. O `onPressingChanged` volta a
    /// `false` ao levantar, ao escorregar mais de 24 pt e quando o sistema cancela o
    /// gesto (o deslizar entre páginas, o pulso a baixar, uma notificação). Depois de
    /// escorregar já não volta a contar, mesmo que o dedo regresse.
    @State private var holding = false

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
            .onLongPressGesture(minimumDuration: 3600, maximumDistance: 24, perform: {}) { pressing in
                holding = pressing
            }
            .onChange(of: holding) { _, holding in
                if case .block = target { model.blockTouches = max(0, model.blockTouches + (holding ? 1 : -1)) }
                if holding { begin() } else { cancel() }
            }
            // Perdeu o toque (o outro bloco também foi tocado): esvazia.
            .onChange(of: model.activeHold) { _, active in
                if active != target, holdTask != nil { cancel() }
            }
            .onDisappear { cancel() }
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { if !disabled { onComplete() } }
    }

    private func begin() {
        if case .block = target, model.blockTouches > 1 { return }
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
