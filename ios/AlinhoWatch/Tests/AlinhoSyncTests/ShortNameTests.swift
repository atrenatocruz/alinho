import Testing
@testable import AlinhoSync

// O nome curto do relógio é o mesmo da web (`shortPersonName`, src/lib/mixLogic.js).

@Test func shortNameFirstAndInitialOfLast() {
    #expect(shortName("Rita Ferreira") == "Rita F.")
    #expect(shortName("Ana Maria Pires") == "Ana P.")
    #expect(shortName("  rui   martins ") == "rui M.")
}

@Test func shortNameSingleWordStaysAsIs() {
    #expect(shortName("Rita") == "Rita")
}

@Test func shortNameEmpty() {
    #expect(shortName("") == "")
    #expect(shortName("   ") == "")
}

@Test func shortNameDropsParentheses() {
    #expect(shortName("Ana (Tita) Silva") == "Ana S.")
    #expect(shortName("Ana Silva (convidada") == "Ana S.")
}

@Test func shortNameKeepsTrailingNumbers() {
    #expect(shortName("Ana Silva 2") == "Ana S. 2")
    #expect(shortName("João 2") == "João 2")
}

@Test func shortNameWithoutLettersReturnsRaw() {
    #expect(shortName("123") == "123")
    #expect(shortName("(Zé)") == "(Zé)")
}

@Test func shortNameInitialIsFirstLetter() {
    #expect(shortName("Rui 'oliveira") == "Rui O.")
    #expect(shortName("Ana élia") == "Ana É.")
}
