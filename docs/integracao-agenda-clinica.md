# 📅 Integração da Agenda — Clínica Imuniza

Olá! Conforme conversamos, precisamos alinhar como vai funcionar a **agenda dos atendimentos** dentro da nova plataforma. Aqui está um passo a passo para vocês entenderem as opções e nos passarem as informações que precisamos.

---

## 🎯 O que muda na prática

A IA da Imuniza recebe os pacientes pelo WhatsApp e, quando o paciente quer **agendar**, ela passa pra equipe humana. A equipe assume a conversa no painel e marca o horário.

O agendamento precisa aparecer em algum lugar que vocês confiem e usem no dia a dia — pode ser **a nossa Agenda interna** (já pronta no painel), **o Google Agenda** de vocês, ou **um sistema próprio** que vocês já usam.

---

## 🛠 Como podemos fazer (3 opções)

### Opção 1 — Usar SÓ a Agenda da plataforma ⭐ *recomendada para começar*

**Como funciona:**
- A equipe registra o agendamento direto no painel, a partir do chat ("Registrar agendamento")
- Aparece num **calendário mensal completo** no painel, com cores por status (agendado, compareceu, pago, não veio)
- A IA pode mandar **lembretes automáticos** no WhatsApp do paciente — vocês configuram quanto tempo antes (24h, 1h, 3 dias…)
- Sem dependência de outros sistemas

**O que vocês precisam fazer:**
- Nada! Já está pronto e funcionando. Só preciso saber:
  - Quantos atendentes vão ter acesso?
  - Quanto tempo antes do agendamento vocês querem mandar o lembrete?

---

### Opção 2 — Sincronizar com o Google Agenda 🔗 *boa se já usam*

**Como funciona:**
- Os agendamentos da plataforma aparecem **automaticamente** no Google Agenda da clínica
- Pode ser **uma via** (só nossa → Google) ou **duas vias** (qualquer alteração em qualquer lado se reflete no outro)
- Vocês continuam usando o Google Agenda no celular/computador normal
- O paciente continua recebendo lembrete pelo WhatsApp

**O que vocês precisam fazer:**
1. Decidir qual conta Google será usada (ex.: `agenda@clinicaimuniza.com.br`)
2. Autorizar nossa plataforma a acessar essa agenda (1 clique de aprovação)
3. Definir se querem **1 calendário só** ou **separado por enfermeira/sala**

**O que precisamos preparar do nosso lado:** a integração via Google Calendar API (3–5 dias de trabalho após receber as decisões).

---

### Opção 3 — Integrar com sistema próprio ⚙️ *se já tem um*

**Como funciona:**
- Se vocês já usam algum sistema de gestão (Doctoralia, Telemedicina, ClinicWeb, sistema próprio…), podemos conectar
- Os agendamentos fluem entre nossa plataforma e o sistema de vocês via API ou planilha

**O que vocês precisam fazer:**
1. Nos passar **qual sistema** vocês usam hoje
2. Verificar se o sistema tem **API ou exportação**
3. Se não tiver, podemos fazer uma ponte com importação periódica (ex.: a cada 30 minutos)

**Tempo de integração:** depende do sistema (3 dias a 2 semanas).

---

## 📋 O que precisamos saber de vocês para escolher

Por favor, respondam estas 5 perguntas:

**1. Como vocês marcam horário hoje?**
- ( ) Caderno/agenda física
- ( ) Google Agenda
- ( ) Excel/planilha
- ( ) Sistema/software específico (qual?: ______________ )
- ( ) Outro: ______________

**2. Quantos profissionais aplicam vacinas?**
- Quantas enfermeiras/atendentes? ______
- Cada uma tem horário próprio ou é fila única? ______________

**3. Vocês querem que o paciente receba lembrete antes do agendamento?**
- ( ) Sim, 24h antes
- ( ) Sim, 24h antes E 1h antes
- ( ) Sim, no dia anterior à noite
- ( ) Outro intervalo: ______________
- ( ) Não, sem lembretes

**4. Qual conta Google vocês usariam para a agenda (caso optem por Google)?**
Email: ______________________________

**5. O que é mais importante pra vocês?**
- ( ) Praticidade — começar rápido, ajustar depois
- ( ) Não mudar a rotina — manter o sistema atual e só conectar
- ( ) Tudo num lugar só — gerenciar tudo pelo painel da Imuniza

---

## 💡 Nossa recomendação para começar

**Começar com a Opção 1** (Agenda interna) e, depois de 2–3 semanas em operação, decidir se querem expandir pra Opção 2 (Google) ou 3 (sistema próprio).

Motivos:
- Já está pronto, sem trabalho de configuração inicial
- Vocês veem na prática o que funciona
- Migrar dados depois é simples — não perde nada
- A IA já cita endereço, horários, valores corretos e dispara lembretes — tudo independente da agenda externa

---

## 📞 Próximos passos

1. Vocês respondem as 5 perguntas acima
2. A gente alinha a opção escolhida em uma call de 15 minutos
3. Iniciamos a configuração (1 dia para Opção 1; 3–5 dias para Opção 2; variável para Opção 3)

Qualquer dúvida estou à disposição 💙

---
*Documento preparado para a Clínica Imuniza — Plataforma de Atendimento Inteligente via WhatsApp.*
