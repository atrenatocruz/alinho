import Foundation

/// Nome curto de uma pessoa, igual ao `shortPersonName` da web
/// (src/lib/mixLogic.js): o primeiro nome e a inicial do último com ponto
/// («Rita Ferreira» → «Rita F.»). O que está entre parênteses sai (um «(» sem
/// fecho leva o resto); números ou símbolos no fim ficam («Ana Silva 2» →
/// «Ana S. 2»). Sem nenhuma palavra com letras, devolve o nome tal e qual.
public func shortName(_ name: String) -> String {
    let raw = name.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { return "" }

    var cleaned = ""
    var inParens = false
    for ch in raw {
        if inParens {
            if ch == ")" { inParens = false }
            continue
        }
        if ch == "(" {
            inParens = true
            cleaned.append(" ")
            continue
        }
        cleaned.append(ch)
    }

    func hasLetter(_ s: Substring) -> Bool { s.contains { $0.isLetter } }
    var tokens = cleaned.split(whereSeparator: { $0.isWhitespace })
    var tail: [Substring] = []
    while let last = tokens.last, !hasLetter(last) {
        tail.insert(last, at: 0)
        tokens.removeLast()
    }
    let parts = tokens.filter(hasLetter)
    guard let first = parts.first, let lastPart = parts.last,
          let initial = lastPart.first(where: { $0.isLetter })
    else { return raw }

    var out = [String(first)]
    if parts.count > 1 { out.append(String(initial).uppercased() + ".") }
    out += tail.map(String.init)
    return out.joined(separator: " ")
}
