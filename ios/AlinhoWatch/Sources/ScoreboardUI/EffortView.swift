#if os(watchOS)
import PadelScoring
import SwiftUI

/// «Quão duro foi?» logo depois do fim (só se houve pontos): 1 a 10 com a coroa.
struct EffortView: View {
    @EnvironmentObject private var model: AppModel
    @State private var value = 6.0

    private var effort: Int { Int(value.rounded()) }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(L.t("Quão duro foi?")).font(.system(size: 18, weight: .heavy))
            Text(L.t("Roda a coroa")).font(.system(size: 12)).foregroundStyle(Theme.muted)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(effort)").font(Theme.number(40)).foregroundStyle(Theme.lime).monospacedDigit()
                Text(Labels.effort(effortLabel(effort))).font(.system(size: 15, weight: .bold))
            }
            HStack(spacing: 2) {
                ForEach(1...10, id: \.self) { i in
                    Capsule().fill(i <= effort ? Theme.lime : Theme.listBg).frame(height: 6)
                }
            }
            Spacer(minLength: 0)
            Button(L.t("Guardar")) { model.saveEffort(effort) }
                .buttonStyle(LimeButtonStyle())
            Button(L.t("Saltar")) { model.skipEffort() }
                .buttonStyle(OutlineButtonStyle())
        }
        .focusable()
        .digitalCrownRotation($value, from: 1, through: 10, by: 1, sensitivity: .low, isContinuous: false)
    }
}
#endif
