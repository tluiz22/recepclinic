import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// PDF de exemplo do modelo do arquivo do preparo (C7; rc_preparo_arquivo_v1):
// a Meta exige um arquivo de exemplo ao criar um modelo com documento no topo.
// Orientações fictícias de um exame, só para a análise da Meta.
export async function samplePreparationPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.07, 0.19, 0.16);
  page.drawText("Orientações de preparo do exame", { x: 56, y: 770, size: 20, font: bold, color: ink });
  page.drawText("Espirometria (exemplo)", { x: 56, y: 742, size: 14, font: regular, color: ink });
  const lines = [
    "No dia do exame:",
    "- Não use broncodilatador nas 4 horas anteriores.",
    "- Evite café e bebidas com cafeína.",
    "- Use roupas confortáveis.",
    "- Chegue 15 minutos antes do horário marcado.",
  ];
  lines.forEach((line, index) => page.drawText(line, { x: 56, y: 700 - index * 22, size: 12, font: index === 0 ? bold : regular, color: ink }));
  return pdf.save();
}
