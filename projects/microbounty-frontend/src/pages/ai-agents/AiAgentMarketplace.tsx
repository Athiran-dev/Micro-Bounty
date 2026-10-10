import { useState, useEffect } from 'react';
import { Search, Database, PenTool, Code, TestTube, Sparkles, Loader2, ArrowRight, Star } from 'lucide-react';
import { getSupabase } from '../../utils/supabaseClient';
import DashboardLayout from '../../components/DashboardLayout';
import { Link, useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import agent1Img from '../../../newUpdatedUi/agent1.png';
import agent2Img from '../../../newUpdatedUi/agent2.png';

export default function AiAgentMarketplace() {
  const [agents, setAgents] = useState<any[]>([]);
  const [reputations, setReputations] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [matcherInput, setMatcherInput] = useState('');
  const [matching, setMatching] = useState(false);
  const [matchedAgent, setMatchedAgent] = useState<any | null>(null);
  
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('ai_agents')
        .select('*')
        .eq('is_active', true)
        .order('reputation_score', { ascending: false });

      if (error) throw error;
      setAgents(data || []);

      // Reputation from judged runs (agent_reputation view). Agents without a row are new.
      const { data: repRows, error: repError } = await supabase.from('agent_reputation').select('*');
      if (repError) console.error("Error fetching agent reputation:", repError);
      setReputations(Object.fromEntries((repRows || []).map((r: any) => [r.agent_id, r])));
    } catch (err) {
      console.error("Error fetching agents:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAIMatch = async () => {
    if (!matcherInput.trim()) return;
    setMatching(true);
    setMatchedAgent(null);
    
    try {
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error("Missing OpenRouter API Key. Please add VITE_OPENROUTER_API_KEY to your .env file.");
      }

      // Format agent data for the LLM to choose from
      const availableAgents = agents.map(a => `ID: ${a.agent_id}, Name: ${a.name}, Category: ${a.category}, Description: ${a.description}`).join('\n');
      
      const prompt = `You are an AI Matchmaker for a decentralized marketplace.
A user needs help with this task: "${matcherInput}"

Here are the available agents:
${availableAgents}

Based on the task, choose the SINGLE BEST agent ID that matches this requirement. 
Respond ONLY with the numerical ID of the agent. If no agent fits perfectly, pick the closest one (e.g., DocuMind AI for text/data, Auditor for code). Do not include any other text.`;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey.replace(/['"]/g, '')}`, // Ensure no quotes
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://microbounty.xyz', // Required by OpenRouter
          'X-Title': 'MicroBounty',
        },
        body: JSON.stringify({
          model: 'openai/gpt-3.5-turbo', // Most standard model
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (response.status === 401) {
        throw new Error("Invalid OpenRouter API Key. Please check your .env file (Status 401).");
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("OpenRouter Error Details:", errorData);
        throw new Error(errorData?.error?.message || "Failed to communicate with AI Matcher.");
      }

      const data = await response.json();
      const recommendedId = parseInt(data.choices[0].message.content.trim());
      
      const found = agents.find(a => a.agent_id === recommendedId) || agents[0];
      setMatchedAgent(found);
      enqueueSnackbar("Match found!", { variant: 'success' });
      
    } catch (err: any) {
      console.error(err);
      enqueueSnackbar(err.message || "Failed to find a match", { variant: 'error' });
    } finally {
      setMatching(false);
    }
  };

  const categories = [
    { name: 'Data', desc: 'ETL & Cleaners', icon: Database, iconColor: 'text-[#6D28D9]', bgColor: 'bg-[#F3E8FF]' },
    { name: 'Content', desc: 'Generative Art', icon: PenTool, iconColor: 'text-[#059669]', bgColor: 'bg-[#D1FAE5]' },
    { name: 'Code', desc: 'Audit & Logic', icon: Code, iconColor: 'text-[#D97706]', bgColor: 'bg-[#FEF3C7]' },
    { name: 'Research', desc: 'Market Analysis', icon: TestTube, iconColor: 'text-[#4B5563]', bgColor: 'bg-[#F3F4F6]' },
  ];

  return (
    <DashboardLayout showSidebar={false}>
      <div className="p-10 max-w-7xl mx-auto font-sans text-gray-900 dark:text-white">

        {/* Header */}
        <div className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <h1 className="text-4xl font-black tracking-tight">
            Browse Agent <span className="text-[#6D28D9]">Marketplace</span>
          </h1>
          <Link 
            to="/ai-tasks/register"
            className="bg-white dark:bg-[#1A1D24] border border-[#6D28D9] text-[#6D28D9] dark:text-[#C4A1FF] dark:border-[#C4A1FF] px-6 py-3 rounded-xl font-bold hover:bg-[#6D28D9] hover:text-white dark:hover:bg-[#C4A1FF] dark:hover:text-[#12141C] transition-all flex items-center gap-2 w-fit"
          >
            <PenTool className="w-4 h-4" /> Deploy Your Agent
          </Link>
        </div>
        <div className="mirror rounded-[2rem] p-8 mb-12 relative overflow-hidden group">
             <div className="absolute top-0 right-0 w-64 h-64 bg-[#C4A1FF]/10 blur-[80px] -mr-32 -mt-32" />
             
             <h2 className="text-xl font-black flex items-center gap-2 mb-3">
                <Sparkles className="w-6 h-6 text-[#C4A1FF]" />
                AI Agent <span className="text-[#C4A1FF]">Matcher</span>
             </h2>
             <p className="text-sm text-[#94A3B8] mb-6 max-w-2xl font-medium">
               Describe your task and our matchmaking AI will instantly recommend the best-suited neural agent from our registry.
             </p>
             
             <div className="flex flex-col sm:flex-row gap-4 items-center">
                <input
                  type="text"
                  value={matcherInput}
                  onChange={(e) => setMatcherInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAIMatch()}
                  placeholder="e.g. I need someone to analyze 10,000 rows of sales data..."
                  className="flex-1 bg-white/5 dark:bg-black/20 backdrop-blur-md border border-white/10 rounded-xl px-6 py-4 text-sm outline-none focus:border-[#C4A1FF] focus:ring-2 focus:ring-[#C4A1FF]/20 transition-all placeholder:text-[#64748B]"
                />
                <button
                  onClick={handleAIMatch}
                  disabled={matching || !matcherInput.trim()}
                  className="bg-[#C4A1FF] hover:bg-[#A37CF0] disabled:opacity-50 text-[#12141C] px-8 py-4 rounded-xl font-black flex items-center gap-2 transition-all shadow-lg shadow-[#C4A1FF]/20 active:scale-95 w-full sm:w-auto justify-center"
                >
                  {matching ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Find Best Agent'}
                </button>
             </div>

             {/* Match Result */}
             {matchedAgent && (
                <div className="mt-6 pt-6 border-t border-gray-100 dark:border-[#334155] animate-in fade-in slide-in-from-top-4">
                   <p className="text-xs font-bold text-gray-400 dark:text-[#64748B] uppercase tracking-widest mb-3">Recommended Agent</p>
                   <div className="flex items-center justify-between bg-gray-50 dark:bg-[#1A1D24] p-4 rounded-xl border border-gray-200 dark:border-[#262A36]">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-[#F3E8FF] flex items-center justify-center overflow-hidden">
                           {matchedAgent.agent_id === 9001 ? (
                              <img src={agent1Img} alt="Avatar" className="w-full h-full object-cover" />
                           ) : matchedAgent.agent_id === 9002 ? (
                              <img src={agent2Img} alt="Avatar" className="w-full h-full object-cover" />
                           ) : (
                              <span className="font-bold text-[#6D28D9] text-xl">{matchedAgent.name[0]}</span>
                           )}
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-900 dark:text-white">{matchedAgent.name}</h3>
                          <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{matchedAgent.category} • {matchedAgent.price_per_task_algo} ALGO</p>
                        </div>
                      </div>
                      <Link 
                        to={`/ai-tasks/${matchedAgent.agent_id}`}
                        className="flex items-center gap-2 text-sm font-bold text-[#6D28D9] hover:bg-[#F3E8FF] px-4 py-2 rounded-lg transition-colors"
                      >
                        View Profile <ArrowRight className="w-4 h-4" />
                      </Link>
                   </div>
                </div>
             )}
          </div>

          <div className="relative max-w-3xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-[#64748B]" />
            <input
              type="text"
              placeholder="Search specialized neural agents or task types..."
              className="w-full bg-white/40 dark:bg-white/5 backdrop-blur-md border border-gray-200 dark:border-white/10 rounded-xl pl-12 pr-4 py-4 text-sm outline-none focus:border-[#C4A1FF] focus:ring-2 focus:ring-[#C4A1FF]/20 transition-all placeholder:text-gray-400 dark:text-[#64748B] shadow-sm"
            />
          </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {categories.map((cat) => (
            <div key={cat.name} className="glass-card p-6 rounded-2xl cursor-pointer hover:border-[#C4A1FF] hover:scale-[1.02] transition-all group">
              <div className={`w-10 h-10 ${cat.bgColor} rounded-lg flex items-center justify-center mb-4`}>
                <cat.icon className={`w-5 h-5 ${cat.iconColor}`} />
              </div>
              <h3 className="font-bold text-gray-900 dark:text-white mb-1">{cat.name}</h3>
              <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{cat.desc}</p>
            </div>
          ))}
        </div>

        {/* Agent Grid */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Available Agents</h2>
          <select className="bg-transparent text-sm font-medium text-gray-500 dark:text-[#94A3B8] outline-none cursor-pointer hover:text-gray-900 dark:text-white">
            <option>Sort by: Success Rate</option>
            <option>Sort by: Price (Low to High)</option>
            <option>Sort by: Reputation</option>
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-[#6D28D9] animate-spin" />
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-20 bg-white dark:bg-[#15171E] border border-gray-200 dark:border-[#262A36] rounded-3xl">
            <p className="text-gray-500 dark:text-[#94A3B8]">No AI agents registered yet.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => (
              <div key={agent.agent_id} className="glass-card rounded-2xl p-6 hover:shadow-2xl hover:scale-[1.02] transition-all group flex flex-col h-full border border-gray-200 dark:border-white/10">
                
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-[#F3E8FF] flex items-center justify-center overflow-hidden border border-[#6D28D9]/10">
                       {agent.avatar_url ? (
                          <img src={agent.avatar_url} alt={agent.name} className="w-full h-full object-cover" />
                       ) : agent.agent_id === 9001 ? (
                          <img src={agent1Img} alt="Avatar" className="w-full h-full object-cover" />
                       ) : agent.agent_id === 9002 ? (
                          <img src={agent2Img} alt="Avatar" className="w-full h-full object-cover" />
                       ) : (
                          <span className="font-bold text-[#6D28D9] text-xl">{agent.name[0]}</span>
                       )}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 dark:text-white text-lg group-hover:text-[#6D28D9] transition-colors">{agent.name}</h3>
                      <p className="text-xs text-gray-500 dark:text-[#94A3B8] leading-snug">{agent.description?.substring(0, 50)}...</p>
                    </div>
                  </div>
                  {agent.successful_tasks > 0 && agent.total_tasks > 0 && (
                     <div className="bg-[#D1FAE5] text-[#059669] px-2 py-1 rounded text-[10px] font-bold">
                       {((agent.successful_tasks / agent.total_tasks) * 100).toFixed(0)}% SUCCESS
                     </div>
                  )}
                </div>

                {/* Badges */}
                <div className="flex gap-2 mb-6 flex-wrap">
                  <span className="px-2.5 py-1 bg-[#F3E8FF] text-[#6D28D9] rounded-full text-[10px] font-bold tracking-wide">
                    {agent.category}
                  </span>
                  {reputations[agent.agent_id]?.reputation != null ? (
                    <span
                      className="px-2.5 py-1 bg-[#FEF3C7] text-[#B45309] rounded-full text-[10px] font-bold tracking-wide flex items-center gap-1"
                      title={`${reputations[agent.agent_id].verified_runs} verified, ${reputations[agent.agent_id].rejected_runs} rejected`}
                    >
                      <Star className="w-3 h-3 fill-current" /> {Number(reputations[agent.agent_id].reputation).toFixed(1)} / 5
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 bg-[#D1FAE5] text-[#059669] rounded-full text-[10px] font-bold tracking-wide">
                      New
                    </span>
                  )}
                  <span className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold tracking-wide">
                    {reputations[agent.agent_id]?.completed_runs ?? 0} Tasks
                  </span>
                  <span className="px-2.5 py-1 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold tracking-wide">
                    v1.0.2
                  </span>
                </div>

                {/* Mock Images grid like in the design */}
                <div className="grid grid-cols-3 gap-2 mb-8 mt-auto">
                   <div className="aspect-square bg-gray-900 rounded-lg overflow-hidden relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-transparent" />
                   </div>
                   <div className="aspect-square bg-gray-900 rounded-lg overflow-hidden relative">
                      <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500/20 to-transparent" />
                   </div>
                   <div className="aspect-square bg-gray-900 rounded-lg overflow-hidden relative">
                      <div className="absolute inset-0 bg-gradient-to-b from-purple-500/20 to-emerald-500/20" />
                   </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-100 dark:border-[#334155] mt-auto">
                  <div>
                    <p className="text-[10px] font-bold text-gray-400 dark:text-[#64748B] uppercase tracking-wider mb-0.5">Price per task</p>
                    <p className="font-black text-xl text-gray-900 dark:text-white">{agent.price_per_task_algo} ALGO</p>
                  </div>
                  <Link
                    to={`/ai-tasks/${agent.agent_id}`}
                    className="bg-[#6D28D9] hover:bg-[#5B21B6] text-white px-5 py-2.5 rounded-xl font-bold text-sm transition-all active:scale-95 shadow-md shadow-[#6D28D9]/20"
                  >
                    Select Agent
                  </Link>
                </div>

              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
