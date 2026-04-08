🔐 Login e Controle de Acesso (RAG)
🔹 Autenticação
Tela de login

Definição: Interface onde o usuário informa credenciais de acesso.
Campos: e-mail e senha.
Objetivo: Autenticar o usuário no sistema.

Regra de autenticação

Regra: Usuários inativos não podem acessar o sistema.
Impacto: Bloqueio total de login.

🔹 Recuperação de senha
Solicitação de redefinição

Ação: Usuário informa o e-mail cadastrado.
Condição: E-mail deve existir no sistema.

Envio de link

Regra: O sistema envia um link de redefinição de senha.
Validade: 30 minutos.
Objetivo: Garantir segurança no processo.

🔹 Permissões de acesso
Controle por perfil

Definição: Permissões são definidas por perfil de usuário.
Impacto: Determina o que cada usuário pode acessar e executar.

Tipos de permissões
visualizar: permite consultar dados
criar: permite cadastrar novos registros
editar: permite alterar registros existentes
excluir: permite remover registros
aprovar: permite validar ou aprovar registros
Escopo das permissões

Regra: Cada perfil define acesso a módulos e ações.
Objetivo: Controle granular de acesso.

🔹 Regra importante
Separação entre visualização e edição

Regra: Um usuário pode visualizar um menu, mas não ter permissão para editar registros.
Impacto: Interface pode exibir módulos sem liberar todas as ações.

🔹 FAQ (Perguntas e Respostas)
Usuário inativo pode acessar o sistema?

Resposta: Não. Usuários inativos não podem acessar o sistema.
Contexto: Autenticação.

Quanto tempo vale o link de redefinição de senha?

Resposta: O link tem validade de 30 minutos.
Contexto: Segurança de acesso.

Permissão de visualização permite edição?

Resposta: Não. Visualização não permite editar registros.
Contexto: Controle de permissões.

O que define as permissões de um usuário?

Resposta: O perfil do usuário define suas permissões.
Contexto: Controle de acesso.

🔹 Palavras-chave

login, entrar, acesso, acessar, autenticação, autenticar, autorização, senha, recuperar senha, recuperação de senha, redefinir senha, link de redefinição, permissão, permissões, perfil, segurança, usuário inativo, controle de acesso

🔹 Observações para RAG
Estrutura com blocos independentes (facilita chunking)
Regras destacadas (importante para respostas diretas)
FAQ melhora matching com linguagem natural
Separação clara entre autenticação e autorização
