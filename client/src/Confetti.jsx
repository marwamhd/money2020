// Falling confetti shared by the big screen ("… takes it") and the winner's phone ("You won").
// The `confettiFall` keyframe lives in styles.css. Fills its nearest positioned ancestor, or
// the viewport when `fixed` is set (the phone page has no positioned container).
const BLUE = "#4984fd";
const SKY = "#8ec7f0";

const CONFETTI_PIECES = Array.from({ length: 70 }, (_, i) => {
  const white = i % 2 === 0;
  return {
    left: Math.random() * 100,
    delay: -Math.random() * 6,
    dur: 4.5 + Math.random() * 3.5,
    w: 5 + Math.random() * 5,
    h: 9 + Math.random() * 9,
    rot: Math.random() * 360,
    bg: white ? "#fff" : i % 3 === 0 ? BLUE : SKY,
  };
});

export default function Confetti({ fixed = false }) {
  return (
    <div style={{ position: fixed ? "fixed" : "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {CONFETTI_PIECES.map((c, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: "-8%",
            left: `${c.left}%`,
            width: c.w,
            height: c.h,
            background: c.bg,
            borderRadius: 2,
            transform: `rotate(${c.rot}deg)`,
            animation: `confettiFall ${c.dur}s linear ${c.delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}
