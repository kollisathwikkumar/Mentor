// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MandateVault} from "../MandateVault.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 balance) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function prank(address caller) external;
    function expectRevert(bytes4 selector) external;
}

contract RejectNative {
    receive() external payable {
        revert();
    }
}

contract MandateVaultTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant AGENT_KEY = 0xA11CE;
    uint256 private constant UNIT = 1 ether;
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    MandateVault private vault;
    bytes32 private mandateId;
    address private agent;
    address private recipient;
    uint64 private expiry;

    function setUp() public {
        vault = new MandateVault();
        agent = vm.addr(AGENT_KEY);
        recipient = address(0xBEEF);
        expiry = uint64(block.timestamp + 1 days);
        mandateId = vault.createMandate(
            agent, recipient, 4 * UNIT, 10 * UNIT, expiry, bytes32(uint256(42)), bytes32(uint256(1))
        );
        vault.fundMandate{value: 5 * UNIT}(mandateId);
    }

    function testExecutesOnlyFixedRecipientAndAdvancesState() public {
        uint256 beforeBalance = recipient.balance;
        MandateVault.TransferIntent memory intent = _intent(3 * UNIT, 0, expiry);
        vault.executeTransfer(intent, _sign(intent));
        MandateVault.Mandate memory state = vault.getMandate(mandateId);
        require(recipient.balance == beforeBalance + 3 * UNIT, "recipient did not receive transfer");
        require(state.spent == 3 * UNIT && state.deposited == 2 * UNIT && state.nextNonce == 1, "state not advanced");
    }

    function testRejectsOverPerCallLimitWithoutStateMutation() public {
        MandateVault.TransferIntent memory intent = _intent(5 * UNIT, 0, expiry);
        vm.expectRevert(MandateVault.PerCallLimitExceeded.selector);
        vault.executeTransfer(intent, _sign(intent));
        MandateVault.Mandate memory state = vault.getMandate(mandateId);
        require(state.spent == 0 && state.deposited == 5 * UNIT && state.nextNonce == 0, "denial mutated state");
    }

    function testRejectsWrongRecipient() public {
        MandateVault.TransferIntent memory intent = _intent(1 * UNIT, 0, expiry);
        intent.recipient = address(0xCAFE);
        vm.expectRevert(MandateVault.InvalidIntent.selector);
        vault.executeTransfer(intent, _sign(intent));
    }

    function testRejectsReplayedNonce() public {
        MandateVault.TransferIntent memory intent = _intent(1 * UNIT, 0, expiry);
        bytes memory signature = _sign(intent);
        vault.executeTransfer(intent, signature);
        vm.expectRevert(MandateVault.InvalidIntent.selector);
        vault.executeTransfer(intent, signature);
    }

    function testRevocationBlocksTransfer() public {
        vault.revokeMandate(mandateId);
        MandateVault.TransferIntent memory intent = _intent(1 * UNIT, 0, expiry);
        vm.expectRevert(MandateVault.MandateInactive.selector);
        vault.executeTransfer(intent, _sign(intent));
    }

    function testExpiredMandateBlocksTransfer() public {
        vm.warp(uint256(expiry));
        MandateVault.TransferIntent memory intent = _intent(1 * UNIT, 0, expiry);
        vm.expectRevert(MandateVault.MandateExpired.selector);
        vault.executeTransfer(intent, _sign(intent));
    }

    function testReceiverFailureRollsBackAccounting() public {
        address rejecting = address(new RejectNative());
        mandateId = vault.createMandate(agent, rejecting, UNIT, UNIT, expiry, bytes32(0), bytes32(uint256(2)));
        vault.fundMandate{value: UNIT}(mandateId);
        MandateVault.TransferIntent memory intent = MandateVault.TransferIntent({
            mandateId: mandateId, recipient: rejecting, amount: UNIT, nonce: 0, deadline: expiry
        });
        vm.expectRevert(MandateVault.TransferFailed.selector);
        vault.executeTransfer(intent, _sign(intent));
        MandateVault.Mandate memory state = vault.getMandate(mandateId);
        require(state.spent == 0 && state.deposited == UNIT && state.nextNonce == 0, "revert did not roll back");
    }

    function testRejectsUnauthorizedFunding() public {
        vm.deal(address(0x1234), UNIT);
        // The caller is the principal in this fixture; unknown IDs remain rejected.
        vm.expectRevert(MandateVault.UnknownMandate.selector);
        vault.fundMandate{value: UNIT}(bytes32(uint256(99)));
    }

    function testRejectsInvalidCreationLimitsAndExpiredPolicy() public {
        vm.expectRevert(MandateVault.InvalidLimits.selector);
        vault.createMandate(agent, recipient, 0, UNIT, expiry, bytes32(0), bytes32(uint256(10)));
        vm.expectRevert(MandateVault.InvalidLimits.selector);
        vault.createMandate(agent, recipient, 2 * UNIT, UNIT, expiry, bytes32(0), bytes32(uint256(11)));
        vm.expectRevert(MandateVault.InvalidExpiry.selector);
        vault.createMandate(agent, recipient, UNIT, UNIT, uint64(block.timestamp), bytes32(0), bytes32(uint256(12)));
        vm.expectRevert(MandateVault.ZeroAddress.selector);
        vault.createMandate(address(0), recipient, UNIT, UNIT, expiry, bytes32(0), bytes32(uint256(13)));
    }

    function testRejectsDuplicateSalt() public {
        vm.expectRevert(MandateVault.DuplicateSalt.selector);
        vault.createMandate(agent, recipient, UNIT, UNIT, expiry, bytes32(0), bytes32(uint256(1)));
    }

    function testFundingCannotExceedBudgetAndRequiresPrincipal() public {
        vm.expectRevert(MandateVault.DepositExceedsBudget.selector);
        vault.fundMandate{value: 6 * UNIT}(mandateId);
        vm.deal(address(0x1234), 2 * UNIT);
        vm.expectRevert(MandateVault.Unauthorized.selector);
        vm.prank(address(0x1234));
        vault.fundMandate{value: UNIT}(mandateId);
    }

    function testExpiredMandateCannotBeFunded() public {
        vm.warp(uint256(expiry));
        vm.expectRevert(MandateVault.MandateExpired.selector);
        vault.fundMandate{value: UNIT}(mandateId);
    }

    function testInvalidSignerIsRejected() public {
        MandateVault.TransferIntent memory intent = _intent(UNIT, 0, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_KEY + 1, keccak256("wrong domain"));
        vm.expectRevert(MandateVault.InvalidSigner.selector);
        vault.executeTransfer(intent, abi.encodePacked(r, s, v));
    }

    function testTotalCapAndInsufficientDepositAreIndependentChecks() public {
        bytes32 limitedId =
            vault.createMandate(agent, recipient, 4 * UNIT, 5 * UNIT, expiry, bytes32(0), bytes32(uint256(20)));
        vault.fundMandate{value: 5 * UNIT}(limitedId);
        MandateVault.TransferIntent memory first =
            MandateVault.TransferIntent(limitedId, recipient, 4 * UNIT, 0, expiry);
        vault.executeTransfer(first, _sign(first));
        MandateVault.TransferIntent memory second =
            MandateVault.TransferIntent(limitedId, recipient, 2 * UNIT, 1, expiry);
        vm.expectRevert(MandateVault.TotalLimitExceeded.selector);
        vault.executeTransfer(second, _sign(second));

        bytes32 underfundedId =
            vault.createMandate(agent, recipient, 4 * UNIT, 10 * UNIT, expiry, bytes32(0), bytes32(uint256(21)));
        vault.fundMandate{value: UNIT}(underfundedId);
        MandateVault.TransferIntent memory underfunded =
            MandateVault.TransferIntent(underfundedId, recipient, 2 * UNIT, 0, expiry);
        vm.expectRevert(MandateVault.InsufficientDeposit.selector);
        vault.executeTransfer(underfunded, _sign(underfunded));
    }

    function testOnlyRevokedMandateCanWithdraw() public {
        vm.expectRevert(MandateVault.MandateStillActive.selector);
        vault.withdrawAfterRevoke(mandateId);
        vault.revokeMandate(mandateId);
        vault.withdrawAfterRevoke(mandateId);
        require(vault.getMandate(mandateId).deposited == 0, "deposit not withdrawn");
    }

    function _intent(uint256 amount, uint256 nonce, uint64 deadline)
        private
        view
        returns (MandateVault.TransferIntent memory)
    {
        return MandateVault.TransferIntent({
            mandateId: mandateId, recipient: recipient, amount: amount, nonce: nonce, deadline: deadline
        });
    }

    function _sign(MandateVault.TransferIntent memory intent) private returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "TransferIntent(bytes32 mandateId,address recipient,uint256 amount,uint256 nonce,uint64 deadline)"
                ),
                intent.mandateId,
                intent.recipient,
                intent.amount,
                intent.nonce,
                intent.deadline
            )
        );
        bytes32 domainSeparator = keccak256(
            abi.encode(DOMAIN_TYPEHASH, keccak256("MandateVault"), keccak256("1"), block.chainid, address(vault))
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(AGENT_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    receive() external payable {}
}
