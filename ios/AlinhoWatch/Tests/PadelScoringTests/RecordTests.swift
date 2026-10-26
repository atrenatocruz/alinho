import Foundation
import Testing
@testable import PadelScoring

// Registo do jogo: esforço, minutos sem pausas e o treino (para a Fase B).

@Test func phase1RecordStillDecodes() throws {
    let json = """
    {"id":"6F9619FF-8B86-D011-B42D-00C04FC964FF","format":"m3","deuceMode":"ouro",
     "sets":[{"us":6,"them":4,"kind":"normal"}],"points":[],"winner":0,"endReason":"rules",
     "startedAt":0,"endedAt":3600,"resultText":"6-4"}
    """
    let r = try JSONDecoder().decode(MatchRecord.self, from: Data(json.utf8))
    #expect(r.version == 1 && r.effort == nil && r.averageHeartRate == nil && r.games == [])
    #expect(r.minutes == 60)
}

@Test func effortIsClampedAndStored() {
    var ses = session(started: match())
    ses.point(.us, at: t0)
    ses.stop(at: t0.addingTimeInterval(600))
    let id = ses.history[0].id
    ses.setEffort(7, for: id)
    #expect(ses.history[0].effort == 7)
    ses.setEffort(11, for: id)
    ses.setEffort(0, for: id)
    #expect(ses.history[0].effort == 7 && ses.history[0].version == 2)
}

@Test func healthIsStored() {
    var ses = session(started: match())
    ses.point(.us, at: t0)
    ses.stop(at: t0.addingTimeInterval(600))
    ses.setHealth(averageHeartRate: 142, kilocalories: 610, for: ses.history[0].id)
    #expect(ses.history[0].averageHeartRate == 142 && ses.history[0].activeKilocalories == 610)
}

@Test func effortLabels() {
    #expect(effortLabel(3) == .easy && effortLabel(4) == .moderate && effortLabel(6) == .moderate)
    #expect(effortLabel(8) == .hard && effortLabel(9) == .max && effortLabel(10) == .max)
}

@Test func minutesExcludePauses() {
    var ses = session(started: match())
    ses.point(.us, at: t0.addingTimeInterval(50))
    ses.togglePause(at: t0.addingTimeInterval(100))
    ses.togglePause(at: t0.addingTimeInterval(400))
    ses.stop(at: t0.addingTimeInterval(1500))
    #expect(ses.history[0].minutes == 20)
}
