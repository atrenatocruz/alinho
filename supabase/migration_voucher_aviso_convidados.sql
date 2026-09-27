-- Aviso do voucher aos convidados do WhatsApp (Francisco, 27 set).
--
-- Quem joga só pelo WhatsApp (conta de convidado, email
-- guest-…@whatsapp.alinho.pt) não vê o voucher na app. Quando ganha um, o
-- robô escreve no grupo do mix, a mencioná-lo (whatsapp-bot/src/voucherNotices.js).
-- Esta coluna diz que o aviso já saiu, para não se repetir depois de um
-- reinício do robô, nem sair duas vezes com dois processos.
--
-- Correr ANTES de reinstalar o robô com o voucherNotices.js. Sem ela o robô
-- não avisa (fica calado, sem erro). Só acrescenta uma coluna: pode correr
-- mais do que uma vez.

ALTER TABLE public.vouchers
  ADD COLUMN IF NOT EXISTS guest_notice_sent_at TIMESTAMPTZ;

-- O robô procura só vouchers recentes ainda por avisar.
CREATE INDEX IF NOT EXISTS idx_vouchers_guest_notice_pending
  ON public.vouchers (created_at)
  WHERE guest_notice_sent_at IS NULL;
