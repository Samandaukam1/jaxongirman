import { GraduationCap } from "lucide-react-native";

import { ComingSoon } from "@/components/ComingSoon";

export default function IlmiyScreen() {
  return (
    <ComingSoon
      Glyph={GraduationCap}
      title="Ilmiy ish"
      summary="Ilmiy maqola, mustaqil ish, referat va kurs ishi — manbalarga tayangan holda, bo‘limma-bo‘lim yoziladi."
      steps={[
        "Ish turini va mavzuni tanlang",
        "Talablar va rejani belgilang",
        "Manbalar yig‘iladi va tekshiriladi",
        "Bo‘limlar ketma-ket yoziladi va saqlanadi",
        "DOCX yoki PDF sifatida yuklab oling",
      ]}
    />
  );
}
