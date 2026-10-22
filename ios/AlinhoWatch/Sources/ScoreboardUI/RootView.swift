#if os(watchOS)
import SwiftUI

/// Sem jogo: «Novo jogo». Jogo a decorrer: marcador e, a deslizar para o lado, o
/// menu do jogo. Jogo acabado: o ecrã de fim.
public struct RootView: View {
    @StateObject private var model = AppModel.launch()

    public init() {}

    public var body: some View {
        Group {
            if model.showHistory {
                NavigationStack { HistoryView() }
            } else if let match = model.current {
                if match.isOver {
                    NavigationStack {
                        EndView(match: match)
                    }
                } else {
                    ZStack {
                        TabView(selection: $model.page) {
                            NavigationStack {
                                ScoreboardView(match: match)
                            }
                            .tag(0)
                            NavigationStack {
                                GameMenuView(match: match)
                            }
                            .tag(1)
                        }
                        .tabViewStyle(.page(indexDisplayMode: .always))
                        if let overlay = model.overlay {
                            OverlayView(overlay: overlay, match: match)
                                .transition(.opacity)
                                .onTapGesture { model.hideOverlay() }
                        }
                    }
                    .animation(.easeInOut(duration: 0.2), value: model.overlay)
                }
            } else {
                SetupView()
            }
        }
        .environmentObject(model)
        .task { await model.resumeWorkoutIfNeeded() }
    }
}
#endif
