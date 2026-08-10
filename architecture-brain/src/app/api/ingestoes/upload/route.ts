import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const EXTENSOES_PLANILHA = [".xlsx", ".xls", ".csv"];
const STORAGE_BUCKET = "ingestoes";

function inferirTipoArquivo(nomeArquivo: string): string | null {
  const nome = nomeArquivo.toLowerCase();
  if (EXTENSOES_PLANILHA.some((ext) => nome.endsWith(ext))) return "planilha";
  return null;
}

// Recebe upload de planilha (xlsx/xls/csv), grava o arquivo no Storage
// e cria o registro de rastreio em `ingestoes` com status "pendente".
// A extração (prompt da seção 4.2) roda depois, disparada a partir desse registro.
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const arquivo = formData.get("arquivo");

  if (!(arquivo instanceof File)) {
    return NextResponse.json(
      { erro: "Envie o arquivo no campo 'arquivo' (multipart/form-data)." },
      { status: 400 }
    );
  }

  const arquivoTipo = inferirTipoArquivo(arquivo.name);
  if (!arquivoTipo) {
    return NextResponse.json(
      { erro: `Formato não suportado. Aceitos: ${EXTENSOES_PLANILHA.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const caminhoStorage = `${arquivoTipo}/${Date.now()}-${arquivo.name}`;
  const { error: erroStorage } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(caminhoStorage, arquivo, {
      contentType: arquivo.type || undefined,
      upsert: false,
    });

  if (erroStorage) {
    return NextResponse.json(
      { erro: `Falha ao gravar arquivo no storage: ${erroStorage.message}` },
      { status: 500 }
    );
  }

  const { data: ingestao, error: erroIngestao } = await supabase
    .from("ingestoes")
    .insert({
      arquivo_nome: arquivo.name,
      arquivo_tipo: arquivoTipo,
      storage_path: caminhoStorage,
      status: "pendente",
    })
    .select()
    .single();

  if (erroIngestao) {
    return NextResponse.json(
      { erro: `Falha ao criar registro de ingestão: ${erroIngestao.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ingestao }, { status: 201 });
}
