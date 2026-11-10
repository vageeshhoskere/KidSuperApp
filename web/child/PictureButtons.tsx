import { PICTURE_WORDS } from "./picture-words";
import { sayWord } from "./speech";

export default function PictureButtons({ onPick }: { onPick: (word: string) => void }) {
  return (
    <div className="strip" role="group" aria-label="Pictures">
      {PICTURE_WORDS.map((w) => (
        <button key={w.word} className="pic" aria-label={w.word} onClick={() => { sayWord(w.word); onPick(w.word); }}>
          {w.emoji}
        </button>
      ))}
    </div>
  );
}
