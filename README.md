# 🧪 RAG + LM Studio — Interface e Laboratório

Este projeto demonstra um sistema de **RAG (Retrieval-Augmented Generation)** rodando localmente com LM Studio.

---

# 💻 Ambiente

- CPU: i7-13650HX  
- RAM: 32 GB  
- GPU: RTX 3050 6GB  
- Execução: 100% local  

---

# 🖥️ Interface do sistema

## 🔹 Tela inicial

![Tela inicial](docs/images/tela_inicial.png)

O sistema inicia com uma interface simples para interação com a documentação.

---

## 🔹 Consulta fora da documentação

![Consulta fora](docs/images/consulta_fora_documentacao.png)

Quando a pergunta não existe na base:

👉 O sistema responde com segurança:  
**"Não encontrei essa informação na documentação."**

---

## 🔹 Temperatura ajustada

![Temperatura](docs/images/temperatura_ajustada.png)

Demonstração do impacto da temperatura:

- 🔹 Baixa temperatura → respostas mais precisas
- 🔹 Alta temperatura → maior variação / fallback

---

# 🧠 Fluxo do sistema

1. Pergunta do usuário  
2. Busca de contexto  
3. Envio para modelo (LM Studio)  
4. Validação (grounding)  
5. Fallback (se necessário)  

---

# 🤖 Modelos testados

- qwen2.5-coder-0.5b-instruct ❌
- qwen2.5-1.5b-instruct ⚠️
- qwen2.5-3b-instruct ✅

---

# 🌡️ Temperatura

| Temperatura | Comportamento |
|------------|--------------|
| 0.0–0.3 | preciso |
| 0.4–0.7 | variável |
| 0.7–0.9 | fallback |

---

# 🚀 Resultado

✔ Sistema confiável  
✔ Sem alucinação relevante  
✔ Respostas seguras  

---

# 📁 Estrutura de imagens

Coloque os prints em:

```
docs/images/
```

Arquivos usados:

- tela_inicial.png  
- consulta_fora_documentacao.png  
- temperatura_ajustada.png  

---

# 🧾 Conclusão

Este projeto mostra que é possível rodar um RAG local confiável usando modelos leves com fallback seguro.
