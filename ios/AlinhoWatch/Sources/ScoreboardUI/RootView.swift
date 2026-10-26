#if os(watchOS)
import SwiftUI

/// Sem jogo: «Novo jogo». Jogo a decorrer: o menu do jogo (deslizar para a direita),
/// o marcador e o treino (deslizar para a esquerda). Jogo acabado: o ecrã de fim.
public struct RootView: View {
    @StateObject private var model = AppModel.launch()

    public init() {}

    public var body: some View {
        Group {
            if model.showHistory {
                NavigationStack { HistoryView() }
            } else if let match = model.current {
                if match.isOver {
                    if model.endStep == .effort {
                        EffortView()
                    } else {
                        NavigationStack {
                            EndView(match: match)
                        }
                    }
                } else {
                    ZStack {
                        TabView(selection: $model.page) {
                            NavigationStack {
                                GameMenuView(match: match)
                            }
                            .tag(0)
                            NavigationStack {
                                ScoreboardView(match: match)
                            }
                            .tag(1)
                            NavigationStack {
                                TrainingView(match: match, recorder: model.recorder)
                            }
                            .tag(2)
                        }
                        .tabViewStyle(.page(indexDisplayMode: .always))
                        if let overlay = model.overlay {
                            OverlayView(overlay: overlay, match: match)
                                .transition(.opacity)
                                .onTapGesture { model.hideOverlay() }
                        }
                    }
                    .animation(.easeInOut(duration: 0.2), value: model.overlay)
                    .fullScreenCover(isPresented: $model.idlePrompt) { IdleView() }
                }
            } else {
                SetupView()
            }
        }
        .environmentObject(model)
        .task { await model.resumeWorkoutIfNeeded() }
        .task {
            // Regresso ao marcador (10 s) e jogo esquecido (20 min).
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                model.tick()
            }
        }
    }
}
#endif
