"use client";

import { use, useState } from "react";
import Link from "next/link";
import { isAddress, type Address } from "viem";
import { useFundSummary, useShareInfo, useComponents } from "@/lib/useFund";
import { USDC, EXPLORER } from "@/lib/config";

const RPC = "https://mainnet.base.org";

function Command({ title, why, cmd }: { title: string; why: string; cmd: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-white">{title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-neutral-500">{why}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(cmd).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => setCopied(false)
            );
          }}
          className="shrink-0 rounded-md border border-white/15 px-2.5 py-1 text-xs text-neutral-300 transition hover:border-white/30 hover:text-white"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-3 font-mono text-xs leading-relaxed text-neutral-300">
        {cmd}
      </pre>
    </div>
  );
}

export default function VerifyPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = use(params);
  const fund = raw as Address;

  const summary = useFundSummary(isAddress(raw) ? fund : undefined);
  const share = useShareInfo(summary.share);
  const components = useComponents(fund, Number(summary.componentsLength ?? 0n));

  if (!isAddress(raw)) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-20">
        <p className="text-sm text-neutral-400">That is not a valid fund address.</p>
      </div>
    );
  }

  const shareAddr = summary.share ?? "<share token>";
  const firstComponent = components[0]?.token ?? "<component>";
  const firstFeed = components[0]?.feed ?? "<feed>";

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href={`/funds/${fund}`}
        className="text-xs text-neutral-500 transition hover:text-neutral-300"
      >
        ← Back to fund
      </Link>

      <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
        Verify this yourself
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-relaxed text-neutral-400">
        Every number this app shows is a public contract call or an event log. None of it requires
        trusting the interface — or us. Below are the exact commands to check each one against Base
        mainnet from your own machine.
      </p>
      <p className="mt-3 max-w-2xl text-xs leading-relaxed text-neutral-600">
        These use <span className="font-mono">cast</span>, from Foundry. Reads work with stock
        Foundry; only the B20-specific tooling needs the Base build.
      </p>

      <div className="mt-8 space-y-4">
        <Command
          title="Net asset value"
          why="Total fund value in USDC terms, priced from Chainlink. Reverts if any feed is stale — that is deliberate."
          cmd={`cast call ${fund} "totalNAV()(uint256)" --rpc-url ${RPC}`}
        />

        <Command
          title="NAV per share"
          why="What one share is worth. Compare against the figure on the fund page."
          cmd={`cast call ${fund} "navPerShare()(uint256)" --rpc-url ${RPC}`}
        />

        <Command
          title="What the fund actually holds"
          why="Custodied balance of a component, read from the token itself rather than from the fund."
          cmd={`cast call ${firstComponent} "balanceOf(address)(uint256)" ${fund} --rpc-url ${RPC}`}
        />

        <Command
          title="Real shares behind that balance"
          why="Applies the token's multiplier. While no stock has rebased this equals the raw balance; after a dividend or split it will not."
          cmd={`cast call ${firstComponent} "scaledBalanceOf(address)(uint256)" ${fund} --rpc-url ${RPC}`}
        />

        <Command
          title="The oracle price being used"
          why="Chainlink Total Return Value, 8 decimals. The fourth field is updatedAt — check how old it is."
          cmd={`cast call ${firstFeed} "latestRoundData()(uint80,int256,uint256,uint256,uint80)" --rpc-url ${RPC}`}
        />

        <Command
          title="Every rebalance, in the fund's own words"
          why="The announcements the fund wrote onchain. This is the same source the history table reads — no indexer in between."
          cmd={`cast logs --address ${shareAddr} \\
  "Announcement(address,string,string,string)" \\
  --from-block earliest --rpc-url ${RPC}`}
        />

        <Command
          title="The rebalance records themselves"
          why="NAV before and after each rebalance, who triggered it, and what it cost."
          cmd={`cast logs --address ${fund} \\
  "Rebalanced(uint256,address,string,uint256,uint256,uint256)" \\
  --from-block earliest --rpc-url ${RPC}`}
        />

        <Command
          title="The index rule, published onchain"
          why="The strategy the fund committed to at creation, stored as metadata on the share token."
          cmd={`cast call ${shareAddr} "extraMetadata(string)(string)" "index_rule" --rpc-url ${RPC}`}
        />

        <Command
          title="What the operator can do"
          why="Published by the fund itself at creation. Cross-check it against the contract source."
          cmd={`cast call ${shareAddr} "extraMetadata(string)(string)" "operator_powers" --rpc-url ${RPC}`}
        />

        <Command
          title="Nobody can freeze your shares"
          why="Transfer policy 0 is the always-allow default, and no account holds PAUSE_ROLE. Both are checkable."
          cmd={`cast call ${shareAddr} "policyId(bytes32)(uint64)" \\
  $(cast keccak "TRANSFER_SENDER_POLICY") --rpc-url ${RPC}
cast call ${shareAddr} "hasRole(bytes32,address)(bool)" \\
  $(cast keccak "PAUSE_ROLE") ${fund} --rpc-url ${RPC}`}
        />

        <Command
          title="Only the fund can mint shares"
          why="No human key holds MINT_ROLE — the contract mints solely against deposited value."
          cmd={`cast call ${shareAddr} "hasRole(bytes32,address)(bool)" \\
  $(cast keccak "MINT_ROLE") ${fund} --rpc-url ${RPC}`}
        />

        <Command
          title="Read the source"
          why="The deployed bytecode is verified. Compare it against this repository."
          cmd={`${EXPLORER}/address/${fund}#code`}
        />
      </div>

      <div className="mt-10 rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <h2 className="text-sm font-medium text-white">What you cannot verify this way</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-400">
          That the underlying tokenized stocks are backed by real shares. That depends on Coinbase
          Onchain SPV Ltd and its custodian, not on any contract here. Slate can prove what it holds
          and what it did with it — it cannot prove what stands behind the assets it holds.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-neutral-600">
          The component tokens also carry a transfer policy their issuer controls. It currently
          behaves as a blocklist, permissive by default, but the policy admin can change who is
          allowed to hold them — including, in principle, this fund.
        </p>
      </div>

      <p className="mt-6 font-mono text-[11px] text-neutral-700">
        USDC {USDC} · {share.symbol ?? ""} {shareAddr}
      </p>
    </div>
  );
}
