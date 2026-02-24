import { useEffect, useRef, useState, useCallback } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/browser';
import { CameraOff, SwitchCamera } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  /** Called once per unique decoded value (debounced — won't fire same value twice in 2 s) */
  onResult: (text: string) => void;
  /** Pause decoding without unmounting (keeps camera stream alive) */
  paused?: boolean;
}

export function BarcodeScanner({ onResult, paused }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const lastResultRef = useRef<{ text: string; at: number }>({ text: '', at: 0 });

  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // List available cameras once on mount
  useEffect(() => {
    BrowserMultiFormatReader.listVideoInputDevices()
      .then((devs) => {
        setCameras(devs);
        // Prefer rear/environment camera on mobile
        const rearIdx = devs.findIndex((d) =>
          /back|rear|environment/i.test(d.label)
        );
        if (rearIdx >= 0) setCameraIndex(rearIdx);
      })
      .catch(() => {
        // Permission not granted yet — will fail below when we try to open camera
      });
  }, []);

  const handleResult = useCallback(
    (text: string) => {
      const now = Date.now();
      // Debounce: ignore same value within 2 seconds
      if (
        text === lastResultRef.current.text &&
        now - lastResultRef.current.at < 2000
      ) return;
      lastResultRef.current = { text, at: now };
      onResult(text);
    },
    [onResult]
  );

  // Start/restart scanning whenever cameraIndex changes or paused toggles
  useEffect(() => {
    if (!videoRef.current) return;

    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;
    setError(null);
    setReady(false);

    const deviceId = cameras[cameraIndex]?.deviceId ?? undefined;

    if (!paused) {
      reader
        .decodeFromVideoDevice(deviceId, videoRef.current, (result, err) => {
          if (result) {
            handleResult(result.getText());
          }
          // NotFoundException is normal — no barcode detected in this frame
          if (err && !(err instanceof NotFoundException)) {
            console.warn('[scanner]', err);
          }
        })
        .then(() => setReady(true))
        .catch((e: Error) => {
          const msg = e?.message ?? 'Could not access camera';
          if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('NotFound')) {
            setError('Camera access denied. Please allow camera in your browser settings.');
          } else {
            setError(msg);
          }
        });
    }

    return () => {
      reader.reset();
    };
  }, [cameras, cameraIndex, paused, handleResult]);

  const switchCamera = () => {
    setCameraIndex((i) => (i + 1) % Math.max(cameras.length, 1));
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 text-center px-8">
        <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
          <CameraOff size={32} className="text-white/60" />
        </div>
        <div>
          <p className="text-white font-medium text-base mb-1">Camera unavailable</p>
          <p className="text-white/50 text-sm leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-black overflow-hidden">
      {/* Camera feed */}
      <video
        ref={videoRef}
        className={clsx(
          'w-full h-full object-cover transition-opacity duration-500',
          ready ? 'opacity-100' : 'opacity-0'
        )}
        playsInline   // required for iOS Safari — prevents fullscreen takeover
        muted
      />

      {/* Loading skeleton while camera warms up */}
      {!ready && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      )}

      {/* Dark vignette overlay */}
      {ready && (
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 60% 50% at 50% 50%, transparent 0%, rgba(0,0,0,0.55) 100%)',
          }}
        />
      )}

      {/* Scanning reticle */}
      {ready && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="relative w-56 h-56">
            {/* Corner marks */}
            {(['tl','tr','bl','br'] as const).map((corner) => (
              <span
                key={corner}
                className={clsx(
                  'absolute w-7 h-7 border-white',
                  corner === 'tl' && 'top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-lg',
                  corner === 'tr' && 'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-lg',
                  corner === 'bl' && 'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-lg',
                  corner === 'br' && 'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-lg',
                )}
              />
            ))}
            {/* Animated scan line */}
            <div className="absolute inset-x-2 top-1/2 h-0.5 bg-gradient-to-r from-transparent via-primary-400 to-transparent opacity-80 animate-scan-line" />
          </div>
        </div>
      )}

      {/* Camera switch button — only shown when >1 camera available */}
      {cameras.length > 1 && ready && (
        <button
          onClick={switchCamera}
          className="absolute top-4 right-4 p-2.5 rounded-full bg-black/50 text-white backdrop-blur-sm active:scale-95 transition-transform"
          aria-label="Switch camera"
        >
          <SwitchCamera size={20} />
        </button>
      )}
    </div>
  );
}
