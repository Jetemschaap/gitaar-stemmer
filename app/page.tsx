"use client";

import { useRef, useState } from "react";

type Snaar = {
  naam: string;
  hz: number;
  index: number;
};

type LampStatus = "uit" | "omhoog" | "goed" | "omlaag";

const gitaarSnaren: Snaar[] = [
  { naam: "E", hz: 82.41, index: 0 },
  { naam: "A", hz: 110.0, index: 1 },
  { naam: "D", hz: 146.83, index: 2 },
  { naam: "G", hz: 196.0, index: 3 },
  { naam: "B", hz: 246.94, index: 4 },
  { naam: "E", hz: 329.63, index: 5 },
];

const snaarBestanden = [
  "snaar-e-laag.png",
  "snaar-a.png",
  "snaar-d.png",
  "snaar-g.png",
  "snaar-b.png",
  "snaar-e-hoog.png",
];

export default function Home() {
  const [microfoonAan, setMicrofoonAan] = useState(false);

  const [gevondenSnaar, setGevondenSnaar] =
    useState<Snaar | null>(null);

  const [frequentie, setFrequentie] = useState(0);
  const [centVerschil, setCentVerschil] = useState(0);

  const [lampStatus, setLampStatus] =
    useState<LampStatus>("uit");

  // Hier bewaren we de laatste cent-metingen.
  const metingenRef = useRef<number[]>([]);

  // Hiermee voorkomen we dat een heel kort stil moment
  // meteen alles uitschakelt.
  const laatsteGeluidRef = useRef<number>(0);

  function autoCorrelate(
    buffer: Float32Array,
    sampleRate: number
  ) {
    let rms = 0;

    for (let i = 0; i < buffer.length; i++) {
      rms += buffer[i] * buffer[i];
    }

    rms = Math.sqrt(rms / buffer.length);

    if (rms < 0.005) {
      return -1;
    }

    let bestOffset = -1;
    let bestCorrelation = 0;

    const minOffset = Math.floor(sampleRate / 400);
    const maxOffset = Math.floor(sampleRate / 70);

    for (
      let offset = minOffset;
      offset <= maxOffset;
      offset++
    ) {
      let correlation = 0;

      for (
        let i = 0;
        i < buffer.length - offset;
        i++
      ) {
        correlation += Math.abs(
          buffer[i] - buffer[i + offset]
        );
      }

      correlation =
        1 -
        correlation / (buffer.length - offset);

      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    }

    if (
      bestCorrelation > 0.9 &&
      bestOffset !== -1
    ) {
      return sampleRate / bestOffset;
    }

    return -1;
  }

  function zoekDichtsteSnaar(hz: number) {
    let dichtste = gitaarSnaren[0];
    let kleinsteVerschil = Infinity;

    gitaarSnaren.forEach((snaar) => {
      const verschil = Math.abs(
        1200 * Math.log2(hz / snaar.hz)
      );

      if (verschil < kleinsteVerschil) {
        kleinsteVerschil = verschil;
        dichtste = snaar;
      }
    });

    if (kleinsteVerschil < 150) {
      return dichtste;
    }

    return null;
  }

  function berekenCent(
    gemetenHz: number,
    goedeHz: number
  ) {
    return 1200 * Math.log2(gemetenHz / goedeHz);
  }

  // We gebruiken niet één meting,
  // maar het gemiddelde van de laatste 8.
  function gemiddeldeCent(nieuweCent: number) {
    const lijst = metingenRef.current;

    lijst.push(nieuweCent);

    if (lijst.length > 8) {
      lijst.shift();
    }

    const totaal = lijst.reduce(
      (som, waarde) => som + waarde,
      0
    );

    return totaal / lijst.length;
  }

  function bepaalLamp(
    cent: number,
    vorigeStatus: LampStatus
  ): LampStatus {
    // Duidelijk goed gestemd
    if (Math.abs(cent) <= 5) {
      return "goed";
    }

    // Duidelijk te laag
    if (cent < -7) {
      return "omhoog";
    }

    // Duidelijk te hoog
    if (cent > 7) {
      return "omlaag";
    }

    // Tussen 5 en 7 cent:
    // NIET meteen omschakelen.
    // Houd de vorige lamp vast.
    return vorigeStatus;
  }

  function trillingSterkte() {
    const verschil = Math.abs(centVerschil);

    // In het groene gebied staat de snaar stil.
    if (verschil <= 5) {
      return 0;
    }

    return Math.min(
      8,
      Math.max(1.2, verschil / 6)
    );
  }

  async function startMicrofoon() {
    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });

      const AudioContextClass =
        window.AudioContext ||
        (
          window as typeof window & {
            webkitAudioContext: typeof AudioContext;
          }
        ).webkitAudioContext;

      const audioContext =
        new AudioContextClass();

      await audioContext.resume();

      const analyser =
        audioContext.createAnalyser();

      analyser.fftSize = 4096;

      const bron =
        audioContext.createMediaStreamSource(
          stream
        );

      bron.connect(analyser);

      const buffer =
        new Float32Array(analyser.fftSize);

      setMicrofoonAan(true);

      let huidigeLamp: LampStatus = "uit";
      let vorigeSnaarIndex = -1;

      function luister() {
        analyser.getFloatTimeDomainData(buffer);

        const hz = autoCorrelate(
          buffer,
          audioContext.sampleRate
        );

        if (hz > 0) {
          const snaar = zoekDichtsteSnaar(hz);

          if (snaar) {
            laatsteGeluidRef.current =
              performance.now();

            // Nieuwe snaar?
            // Dan oude metingen eerst wissen.
            if (snaar.index !== vorigeSnaarIndex) {
              metingenRef.current = [];
              vorigeSnaarIndex = snaar.index;
              huidigeLamp = "uit";
            }

            const rauweCent = berekenCent(
              hz,
              snaar.hz
            );

            const rustigeCent =
              gemiddeldeCent(rauweCent);

            const rustigeHz =
              snaar.hz *
              Math.pow(2, rustigeCent / 1200);

            setGevondenSnaar(snaar);
            setCentVerschil(rustigeCent);
            setFrequentie(rustigeHz);

            huidigeLamp = bepaalLamp(
              rustigeCent,
              huidigeLamp
            );

            setLampStatus(huidigeLamp);
          }
        }

        // Pas na ongeveer 350 ms zonder bruikbaar geluid
        // zetten we alles uit.
        if (
          performance.now() -
            laatsteGeluidRef.current >
          350
        ) {
          setGevondenSnaar(null);
          setFrequentie(0);
          setCentVerschil(0);
          setLampStatus("uit");

          huidigeLamp = "uit";
          vorigeSnaarIndex = -1;
          metingenRef.current = [];
        }

        requestAnimationFrame(luister);
      }

      luister();
    } catch (error) {
      console.error(error);

      alert(
        "De microfoon kon niet worden gestart."
      );
    }
  }

  const sterkte = trillingSterkte();

  return (
    <>
      <style jsx global>{`
        html,
        body {
          margin: 0;
          padding: 0;
          overflow: hidden;
          background: black;
        }

        @keyframes snaarTrillen {
          0% {
            transform: translateX(
              calc(var(--trilling) * -1px)
            );
          }

          50% {
            transform: translateX(
              calc(var(--trilling) * 1px)
            );
          }

          100% {
            transform: translateX(
              calc(var(--trilling) * -1px)
            );
          }
        }

        .trillende-snaar {
          animation: snaarTrillen
            0.08s linear infinite;
        }
      `}</style>

      <main
        style={{
          width: "100vw",
          height: "100dvh",
          overflow: "hidden",
          backgroundColor: "#000",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
          }}
        >
          {/* GITAAR */}
          <img
            src="/images/gitaar.png"
            alt="Gitaar"
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
          />

          {/* 6 SNAREN */}
          {snaarBestanden.map(
            (bestand, index) => {
              const dezeSnaarTrilt =
                gevondenSnaar?.index === index &&
                sterkte > 0;

              return (
                <img
                  key={bestand}
                  src={`/images/${bestand}`}
                  alt=""
                  className={
                    dezeSnaarTrilt
                      ? "trillende-snaar"
                      : ""
                  }
                  style={
                    {
                      position: "absolute",
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      pointerEvents: "none",
                      "--trilling": sterkte,
                    } as React.CSSProperties
                  }
                />
              );
            }
          )}

          {/* LINKS: HOGER STEMMEN */}
          <img
            src={
              lampStatus === "omhoog"
                ? "/images/pijl-omhoog-aan.png"
                : "/images/pijl-omhoog-uit.png"
            }
            alt="Hoger stemmen"
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              pointerEvents: "none",
            }}
          />

          {/* MIDDEN: GOED GESTEMD */}
          <img
            src={
              lampStatus === "goed"
                ? "/images/lamp-groen-aan.png"
                : "/images/lamp-groen-uit.png"
            }
            alt="Goed gestemd"
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              pointerEvents: "none",
            }}
          />

          {/* RECHTS: LAGER STEMMEN */}
          <img
            src={
              lampStatus === "omlaag"
                ? "/images/pijl-omlaag-aan.png"
                : "/images/pijl-omlaag-uit.png"
            }
            alt="Lager stemmen"
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              objectFit: "contain",
              pointerEvents: "none",
            }}
          />

          {/* ONDERAAN */}
          <div
            style={{
              position: "absolute",
              bottom: "25px",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            {!microfoonAan ? (
              <button
                onClick={startMicrofoon}
                style={{
                  padding: "16px 25px",
                  fontSize: "24px",
                  fontWeight: "bold",
                  borderRadius: "10px",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                MICROFOON STARTEN
              </button>
            ) : (
              <div
                style={{
                  color: "white",
                  fontSize: "30px",
                  fontWeight: "bold",
                  textShadow: "0 2px 5px black",
                }}
              >
                {gevondenSnaar ? (
                  <>
                    {gevondenSnaar.naam}{" "}
                    {frequentie.toFixed(1)} Hz
                    <br />

                    <span
                      style={{
                        fontSize: "22px",
                      }}
                    >
                      {Math.round(
                        centVerschil
                      )}{" "}
                      cent
                    </span>
                  </>
                ) : (
                  "Sla een snaar aan"
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}