---
impacto: capacidade_nova
secao: adicionado
titulo: WhatsApp por Evolution API como transporte alternativo
---
Novo transporte de WhatsApp (Evolution API, Baileys) ao lado do atual: uma instância por canal, QR e código de pareamento, recebimento, envio, confirmações, mídia e saúde da conexão pelos mesmos caminhos dos demais canais. Fica desligado até `EVOLUTION_API_BASE_URL` e `EVOLUTION_API_KEY` serem configurados; o canal atual segue como padrão e nada muda para quem não usa. A atualização aplica a migration 0345 (coluna e RPC novas, sem tocar dados existentes).
