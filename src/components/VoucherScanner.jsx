import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Html5Qrcode } from 'html5-qrcode'
import { Camera, CameraOff, ScanLine } from 'lucide-react'

const SCANNER_ELEMENT_ID = 'voucher-qr-scanner'

// Camera-based QR scanning, exposed purely as active/onToggle/onDecode —
// this component owns no state about *what* was scanned, only the camera
// lifecycle (start on `active`, stop on cleanup). `onDecode` fires once
// per successful scan; the caller is responsible for setting `active`
// back to false afterwards so a second stray frame can't fire a second
// decode while the parent is still processing the first one.
//
// Off by default wherever it's mounted (the parent controls `active`) —
// this avoids an unsolicited camera permission prompt the moment the
// redeem screen opens, and keeps the always-present manual-entry input
// genuinely equal-first-class rather than a hidden fallback.
export default function VoucherScanner({ active, onToggle, onDecode }) {
  const { t } = useTranslation()
  const instanceRef = useRef(null)
  const [permissionError, setPermissionError] = useState(false)

  useEffect(() => {
    if (!active) return

    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID)
    instanceRef.current = scanner
    setPermissionError(false)

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220 },
        (decodedText) => onDecode(decodedText),
        () => {} // per-frame "no code in this frame" callback — expected on every frame without a code in view, not an error
      )
      .catch((err) => {
        console.error('Error starting camera:', err)
        setPermissionError(true)
      })

    return () => {
      scanner
        .stop()
        .catch(() => {}) // already stopped/never started — fine to ignore
        .finally(() => scanner.clear())
    }
  }, [active])

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-center gap-2 text-sm font-extrabold px-4 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
      >
        {active ? <CameraOff size={16} /> : <Camera size={16} />}
        {active ? t('gerirclube.redeem_stop_camera') : t('gerirclube.redeem_start_camera')}
      </button>
      {active && (
        <div className="mt-3 relative rounded-ctrl overflow-hidden bg-ink-900" id={SCANNER_ELEMENT_ID} />
      )}
      {permissionError && (
        <p className="text-sm text-muted mt-2 flex items-center gap-1.5">
          <ScanLine size={14} /> {t('gerirclube.redeem_camera_unavailable')}
        </p>
      )}
    </div>
  )
}
