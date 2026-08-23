import { Image as ImageIcon } from "lucide-react-native";

import { ComingSoon } from "@/components/ComingSoon";

export default function PortraitScreen() {
  return (
    <ComingSoon
      Glyph={ImageIcon}
      title="3×4 rasm"
      summary="Hujjatlar uchun rasmiy 3×4 fotosurat tayyorlang va chop etishga tayyor A6 varaqni yuklab oling."
      steps={[
        "Tayyor promptni nusxalang",
        "Promptni va o‘z rasmingizni ChatGPT’ga yuboring",
        "Qaytgan natijani shu yerga yuklang",
        "9 ta rasm joylashgan A6 PDF’ni chop etishga oling",
      ]}
    />
  );
}
