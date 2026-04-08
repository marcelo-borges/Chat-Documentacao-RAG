📑 NF-e - Nota Fiscal Eletrônica de Produtos
🔹 Objetivo
Definição: Documento digital que acoberta a circulação de mercadorias entre partes.
Escopo: Emissão, recepção e validação junto à SEFAZ.

🔹 Regras de Negócio
Status de Autorização
Regra: Uma nota só é considerada válida juridicamente após receber o protocolo de "Autorização de Uso" da SEFAZ.
Impacto: Mercadorias não podem sair do estabelecimento sem o DANFE com chave de acesso autorizada.

Validação de NCM
Regra: Cada item da nota deve possuir um código NCM (Nomenclatura Comum do Mercosul) válido de 8 dígitos.
Impacto: O NCM incorreto causa a rejeição imediata da nota (Rejeição 602).

🔹 Regras de Tela
Monitor de Notas
Visual: Lista de notas com ícones de status (Azul: Transmissão, Verde: Autorizada, Vermelho: Rejeitada/Cancelada).
Ações: Botão "Transmitir" deve ser desabilitado se o cadastro do cliente estiver incompleto.

Preview do DANFE
Função: Permitir a visualização do espelho da nota antes da transmissão definitiva para evitar erros.

🔹 FAQ
O que é o DANFE?
Resposta: É o Documento Auxiliar da Nota Fiscal Eletrônica, uma representação gráfica simplificada da NF-e para acompanhar o transporte.

O que fazer em caso de rejeição?
Resposta: O sistema exibirá o código da rejeição da SEFAZ; o usuário deve corrigir o dado apontado e clicar em "Reenviar".

🔹 Palavras-chave
nfe, nf-e, nota fiscal eletrônica, nota fiscal, produtos, mercadoria, sefaz, danfe, xml, emissão, emitir, transmissão, transmitir, autorização de uso, protocolo de autorização, chave de acesso, rejeição, reenviar, ncm, nomenclatura comum do mercosul

🔹 Observações para RAG
Foco na dependência de serviço externo (SEFAZ).
Diferenciação entre XML (valor jurídico) e DANFE (representação física).
