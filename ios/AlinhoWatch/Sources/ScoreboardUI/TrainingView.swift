#if os(watchOS)
import PadelScoring
import SwiftUI

/// Terceiro ecrã (deslizar para a esquerda): o treino. Tempo de jogo, pulsação,
/// calorias, pulsação média e a zona. Sem acesso ao Saúde, diz que o jogo conta na mesma.
struct TrainingView: View {
    let match: MatchState
    @ObservedObject var recorder: WorkoutRecorder

    var body: some View {
        Group {
            if recorder.authorized == false {
                Text(L.t("Sem acesso ao Saúde. O jogo conta na mesma; o treino não fica guardado."))
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            } else {
                VStack(alignment: .leading, spacing: 2) {
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        Text(clock(match.elapsed(at: context.date)))
                            .font(Theme.number(34))
                            .foregroundStyle(Theme.lime)
                            .monospacedDigit()
                    }
                    metric(Text("♥ ").foregroundStyle(Theme.red) + Text(recorder.heartRate.map(String.init) ?? "--"), L.t("BPM"))
                    metric(Text("\(Int(recorder.kilocalories.rounded()))"), L.t("KCAL"))
                    metric(Text(recorder.averageHeartRate.map(String.init) ?? "--"), L.t("BPM MÉDIO"), size: 17)
                    zones
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .navigationTitle(L.t("Treino"))
    }

    private func clock(_ seconds: TimeInterval) -> String {
        let s = Int(seconds)
        return "\(s / 60):" + String(format: "%02d", s % 60)
    }

    private func metric(_ value: Text, _ unit: String, size: CGFloat = 22) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            value.font(Theme.number(size))
            Text(unit).font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.muted)
        }
    }

    private var zones: some View {
        let current = recorder.heartRate.map(WorkoutRecorder.zone)
        return HStack(spacing: 3) {
            ForEach(1...5, id: \.self) { z in
                Capsule()
                    .fill(z == current ? Theme.lime : Theme.listBg)
                    .frame(height: 6)
            }
        }
        .padding(.top, 4)
    }
}
#endif
