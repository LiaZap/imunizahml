import type OpenAI from 'openai';

export const functionDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'send_reply',
      description:
        'Envia uma mensagem de texto ao paciente via WhatsApp. Use para responder, pedir esclarecimentos ou orientar.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Texto em português, conciso e acolhedor.' },
        },
        required: ['text'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_patient_profile',
      description:
        'Atualiza dados do perfil do paciente (nome do paciente, idade do bebê, nome do bebê, condições). Campos omitidos permanecem inalterados.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'Nome do PACIENTE (como ele/ela quer ser chamado). Use o primeiro nome ou apelido informado. NUNCA use o pushName que aparece no WhatsApp (pode ser nome completo, nome de empresa, etc) — só registre o que o paciente disser explicitamente. Se o paciente recusar dar o nome, use "Não informado".',
          },
          babyAgeMonths: { type: 'number', description: 'Idade do bebê em meses' },
          babyName: { type: 'string', description: 'Nome do bebê/criança quando a vacina não é pro paciente' },
          medicalConditions: { type: 'array', items: { type: 'string' } },
          vaccineHistory: { type: 'array', items: { type: 'string' } },
          notes: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_kb',
      description:
        'Busca trechos da base de conhecimento sobre vacinas. Use quando precisar de detalhes sobre uma vacina específica ou dúvida técnica.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          topK: { type: 'integer', minimum: 1, maximum: 10, default: 4 },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_vaccines',
      description:
        'Lista vacinas disponíveis no catálogo com preços, estoque e idades recomendadas. NÃO filtra por idade — sempre retorna o catálogo completo (ou um subset filtrado por nome). Use SEMPRE que o paciente perguntar preço/estoque/disponibilidade de uma vacina específica (ex: "qual o preço da gripe?", "tem HPV?"). Para recomendação por idade, use `recommend_vaccines`.',
      parameters: {
        type: 'object',
        properties: {
          nameLike: {
            type: 'string',
            description:
              'Filtro opcional por substring do nome/slug/descrição (case-insensitive). Ex: "gripe", "HPV", "meningo", "pneumo". Se omitido, retorna todas as vacinas.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recommend_vaccines',
      description:
        'Recomenda vacinas para um perfil. Use após identificar a idade do bebê. Retorna lista com preços.',
      parameters: {
        type: 'object',
        properties: {
          ageMonths: { type: 'integer', minimum: 0 },
          conditions: { type: 'array', items: { type: 'string' } },
        },
        required: ['ageMonths'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_packages',
      description:
        'Lista PACOTES de vacinas disponíveis (ex: pacote 2-6 meses, pacote HPV 9 com 3 doses, pacote 1a-1a6m). Use SEMPRE que o paciente perguntar sobre pacotes/combos/fechado/3 doses do HPV/pacote completo/desconto/economia. NÃO assuma que não existe — sempre consulte primeiro. Mesma idéia do list_vaccines mas pra pacotes.',
      parameters: {
        type: 'object',
        properties: {
          nameLike: {
            type: 'string',
            description:
              'Filtro opcional por substring do nome/slug/descrição do pacote (case-insensitive). Ex: "hpv", "2-6", "bebê". Se omitido, retorna todos os pacotes ativos.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'register_appointment',
      description:
        'Cria um agendamento no sistema (banco + Google Calendar + lembretes automáticos). Use QUANDO o paciente já confirmou dia E hora específicos ("segunda 14h", "amanhã 10:30", etc), dentro do horário comercial. Requer nome do paciente registrado. Se o paciente ainda estiver indeciso, negociar horário ou não souber vacina, use `request_handoff` em vez disso.',
      parameters: {
        type: 'object',
        properties: {
          scheduledFor: {
            type: 'string',
            description:
              'Data e hora do agendamento em formato ISO 8601 com timezone -03:00 (Brasília). Ex: "2026-07-05T14:00:00-03:00". Você MESMO calcula a data absoluta a partir do que o paciente disse (ex: "quinta 14h", "dia 5 às 10:30"), usando currentDate como referência.',
          },
          vaccineSlugs: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Slugs das vacinas do agendamento. Use OS SLUGS EXATOS retornados por list_vaccines / recommend_vaccines (ex: "pneumococica-15", "meningococica-b").',
          },
          expectedValue: {
            type: 'number',
            description:
              'Valor total previsto do atendimento em reais. Some os priceCash das vacinas selecionadas. Opcional — se omitir, o sistema soma sozinho.',
          },
          notes: {
            type: 'string',
            description:
              'Observações relevantes (ex: "primeira dose", "paciente prefere manhã", "chegar 15min antes"). Opcional.',
          },
        },
        required: ['scheduledFor', 'vaccineSlugs'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_handoff',
      description:
        'Encaminha o paciente para a equipe humana (fila de agendamento). Use quando o paciente quiser agendar, tiver dúvida que você não pode resolver, ou sintoma preocupante.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            enum: ['scheduling', 'clinical_concern', 'complex_question', 'patient_request'],
          },
          summary: {
            type: 'string',
            description: 'Resumo curto da situação do paciente para o atendente.',
          },
        },
        required: ['reason', 'summary'],
        additionalProperties: false,
      },
    },
  },
];
