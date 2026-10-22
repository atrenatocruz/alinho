#if os(watchOS)
import PadelScoring
import SwiftUI

/// O marcador (PDF p. 5 e 6): linha de cima, os blocos «NÓS» e «ELES» e
/// «↺ Desfazer». Com o pulso em baixo escurece e fica só o resultado.
struct ScoreboardView: View {
    let match: MatchState

    @EnvironmentObject private var model: AppModel
    @Environment(\.isLuminanceReduced) private var dim

    var body: some View {
        let display = match.display
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                block(.us, display.us)
                block(.them, display.them)
            }
            if !dim {
                HoldButton(
                    target: .undo,
                    fillFromBottom: false,
                    fillColor: .white.opacity(0.22),
                    cornerRadius: 20,
                    disabled: !model.session.canUndo,
                    onComplete: model.undo
                ) {
                    Text("↺ " + L.t("Desfazer"))
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .overlay(Capsule().strokeBorder(.white, lineWidth: 1.5))
                }
                .opacity(model.session.canUndo ? 1 : 0.35)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                topLine(display.status)
            }
        }
    }

    @ViewBuilder
    private func topLine(_ status: StatusLabel?) -> some View {
        Group {
            if let status {
                Text(Labels.status(status))
                    .font(.system(size: 15, weight: .heavy))
                    .foregroundStyle(Theme.lime)
            } else {
                Text(match.setsLine)
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(Theme.topLine)
            }
        }
        .lineLimit(1)
        .opacity(dim ? 0.6 : 1)
    }

    private func block(_ team: Team, _ mark: PointMark) -> some View {
        let text = Labels.mark(mark)
        let background = team == .us ? (dim ? Theme.dimLime : Theme.lime) : (dim ? Theme.dimGrey : Theme.themGrey)
        let ink = dim ? Theme.dimText : Theme.ink
        return HoldButton(target: .block(team), onComplete: { model.point(team) }) {
            ZStack {
                background
                VStack {
                    Text(team == .us ? L.t("Nós") : L.t("Eles"))
                        .font(.system(size: 11, weight: .heavy))
                        .textCase(.uppercase)
                        .tracking(0.6)
                        .padding(.top, 8)
                    Spacer()
                    if match.server == team {
                        Circle().fill(ink).frame(width: 10, height: 10).padding(.bottom, 10)
                    }
                }
                Text(text)
                    .font(Theme.number(text.count > 3 ? 30 : 46))
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                    .contentTransition(.numericText())
                    .scaleEffect(model.flash == team ? 1.12 : 1)
                    .animation(.spring(duration: 0.22), value: model.flash)
                    .animation(.default, value: text)
                    .padding(.horizontal, 4)
            }
            .foregroundStyle(ink)
            .overlay {
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(.white, lineWidth: model.flash == team ? 3 : 0)
            }
        }
        .accessibilityLabel(team == .us ? L.t("Nós") : L.t("Eles"))
        .accessibilityValue(text)
    }
}
#endif
