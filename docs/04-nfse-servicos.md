📑 NFS-e - Nota Fiscal de Serviços Eletrônica
🔹 Objetivo
Definição: Registro de prestações de serviços tributadas pelo ISSQN (Imposto Sobre Serviços de Qualquer Natureza).

🔹 Regras de Negócio
Competência e Município
Regra: A emissão da NFS-e segue o layout da prefeitura onde o serviço foi prestado.
Integração: O sistema deve converter o RPS (Recibo Provisório de Serviços) em NFS-e em até 5 dias úteis.

Retenção de Impostos
Regra: O sistema deve calcular automaticamente a retenção de ISS, PIS e COFINS se o valor bruto ultrapassar o limite configurado por lei municipal.

🔹 Regras de Tela
Configuração de Alíquotas
Interface: Cadastro de alíquotas de ISS por item de serviço conforme a legislação municipal vigente.

RPS Pendente
Visual: Alerta no dashboard para notas enviadas como RPS que ainda não foram convertidas pela prefeitura.

🔹 FAQ
O que é o RPS?
Resposta: É o Recibo Provisório de Serviços, emitido quando o sistema da prefeitura está offline ou para posterior conversão em nota definitiva.

Como cancelar uma NFS-e?
Resposta: O cancelamento depende das regras de cada prefeitura; em algumas, após 48h, só é possível via processo administrativo no portal municipal.

🔹 Palavras-chave
nfse, nfs-e, nota fiscal de serviços, nota fiscal de servico, serviço, serviços, iss, issqn, prefeitura, portal municipal, rps, recibo provisório de serviços, recibo provisório de servicos, retenção, retenção de impostos, tributação municipal, cancelar nfse, cancelamento nfse

🔹 Observações para RAG
Destaque para a variação de regras conforme a prefeitura (integração via webservice).
