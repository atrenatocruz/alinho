// Criar um jogo entre amigos (#342). Dois ecrãs aprovados, um interruptor:
// 'friend_invites' ligado → convidar primeiro, equipas depois, mais de 4
// (CreateFriendMatch, precisa da migração do Dev 3); desligado → os 4 lugares
// de hoje (CreatePrivateMatchSlots). Desligado por omissão, para o main
// nunca ficar preso à migração (PO, 26 set); liga-se quando o SI a correr.
import { useFeatureFlag } from '../lib/useFeatureFlag'
import CreateFriendMatch from './CreateFriendMatch'
import CreatePrivateMatchSlots from './CreatePrivateMatchSlots'

export default function CreatePrivateMatch() {
  const { on, loading } = useFeatureFlag('friend_invites')
  if (loading) {
    return <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }
  return on ? <CreateFriendMatch /> : <CreatePrivateMatchSlots />
}
