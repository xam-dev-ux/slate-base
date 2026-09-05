SEPOLIA_RPC_URL := https://sepolia.base.org
MAINNET_RPC_URL := https://mainnet.base.org
DEPLOYER := 0x8F058fE6b568D97f85d517Ac441b52B95722fDDe

.PHONY: install build test test-fork test-all check-keystore \
        deploy-factory-sepolia deploy-factory-mainnet deploy-funds-mainnet

install:
	base-forge install base/base-std --no-git

build:
	base-forge build

# Unit tests only — no network required.
test:
	base-forge test --no-match-contract Fork -vv

# Fork tests pin their own mainnet block in setUp, so no --fork-url is needed here.
test-fork:
	base-forge test --match-contract Fork -vv

test-all:
	base-forge test -vv

check-keystore:
	@base-cast wallet address --account speedrun | \
		grep -qi "$(DEPLOYER)" && echo "keystore OK" || \
		(echo "KEYSTORE MISMATCH" && exit 1)

deploy-factory-sepolia: check-keystore
	base-forge script script/DeployFactory.s.sol \
		--rpc-url $(SEPOLIA_RPC_URL) --account speedrun --broadcast --verify -vv

deploy-factory-mainnet: check-keystore
	@echo "Deploying SlateFactory to Base MAINNET. Ctrl-C to abort."
	@sleep 5
	base-forge script script/DeployFactory.s.sol \
		--rpc-url $(MAINNET_RPC_URL) --account speedrun --broadcast --verify -vv

deploy-funds-mainnet: check-keystore
	@echo "Deploying funds to Base MAINNET. Ctrl-C to abort."
	@sleep 5
	base-forge script script/DeployFunds.s.sol \
		--rpc-url $(MAINNET_RPC_URL) --account speedrun --broadcast --verify -vv
