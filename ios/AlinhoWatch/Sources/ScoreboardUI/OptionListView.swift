#if os(watchOS)
import SwiftUI

struct Option<Value: Hashable>: Identifiable {
    let value: Value
    let label: String
    var id: String { label }
}

/// Lista de escolha com visto (PDF p. 5, «Formato», «Quem serve primeiro»,
/// «Aos 40-40»). Desce-se com a coroa. Por baixo, a ajuda da opção marcada.
struct OptionListView<Value: Hashable>: View {
    let title: String
    let options: [Option<Value>]
    let selected: Value
    var help: (Value) -> String? = { _ in nil }
    let onPick: (Value) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                ForEach(options) { option in
                    Button {
                        onPick(option.value)
                        dismiss()
                    } label: {
                        HStack {
                            Text(option.label)
                                .font(.system(size: 16, weight: .bold))
                                .frame(maxWidth: .infinity, alignment: .leading)
                            Circle()
                                .strokeBorder(option.value == selected ? Theme.lime : Theme.muted, lineWidth: 1.5)
                                .background(Circle().fill(option.value == selected ? Theme.lime : .clear).padding(3))
                                .frame(width: 18, height: 18)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(RoundedRectangle(cornerRadius: 14).fill(Theme.listBg))
                        .overlay {
                            if option.value == selected {
                                RoundedRectangle(cornerRadius: 14).strokeBorder(Theme.lime, lineWidth: 1.5)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
                if let text = help(selected) {
                    Text(text)
                        .font(.system(size: 13))
                        .foregroundStyle(Theme.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 4)
                }
            }
        }
        .navigationTitle(title)
    }
}
#endif
