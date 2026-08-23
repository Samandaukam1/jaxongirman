import { FileText } from "lucide-react-native";

import { ComingSoon } from "@/components/ComingSoon";

export default function ObyektivkaScreen() {
  return (
    <ComingSoon
      Glyph={FileText}
      title="Obyektivka"
      summary="Ma’lumotnomani to‘ldiring va uni DOCX yoki PDF sifatida yuklab oling. Profilingizdagi ma’lumotlar avtomatik qo‘yiladi."
      steps={[
        "Shaxsiy ma’lumotlarni to‘ldiring",
        "Mehnat faoliyati qatorlarini qo‘shing",
        "3×4 rasmni tanlang yoki yarating",
        "DOCX yoki PDF sifatida yuklab oling",
      ]}
    />
  );
}
